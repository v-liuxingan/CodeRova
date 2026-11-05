use crate::model::CallGraph;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub revision: String,
    pub removed_node_ids: Vec<String>,
    pub removed_edge_ids: Vec<String>,
    pub preserved_shared_node_ids: Vec<String>,
    pub applied: bool,
}

fn reachable<'a>(
    seeds: Vec<&'a str>,
    edges: &HashMap<&str, Vec<&'a str>>,
    stop: &HashSet<&str>,
) -> HashSet<&'a str> {
    let mut queue = seeds;
    let mut seen = HashSet::new();
    while let Some(id) = queue.pop() {
        if stop.contains(id) || !seen.insert(id) {
            continue;
        }
        if let Some(next) = edges.get(id) {
            queue.extend(next);
        }
    }
    seen
}

pub fn plan(graph: &CallGraph, id: &str) -> Result<Plan, String> {
    plan_many(graph, &[id.to_owned()])
}

pub fn plan_many(graph: &CallGraph, ids: &[String]) -> Result<Plan, String> {
    let selected: HashSet<&str> = ids.iter().map(String::as_str).collect();
    if selected.is_empty() {
        return Err("请选择至少一个节点".into());
    }
    if selected.contains(graph.root.as_str()) {
        return Err("不能减枝图的根节点；整图删除请使用回收站".into());
    }
    let known: HashSet<&str> = graph.nodes.iter().map(|n| n.id.as_str()).collect();
    if !selected.is_subset(&known) {
        return Err("节点不存在".into());
    }
    let mut edges: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in &graph.edges {
        edges.entry(&edge.from).or_default().push(&edge.to);
    }
    let candidates = reachable(
        selected.iter().copied().collect(),
        &edges,
        &HashSet::from([graph.root.as_str()]),
    );
    let outside = graph
        .nodes
        .iter()
        .filter(|n| !candidates.contains(n.id.as_str()))
        .map(|n| n.id.as_str())
        .collect();
    let kept = reachable(outside, &edges, &selected);
    let removed: HashSet<_> = candidates.difference(&kept).copied().collect();
    Ok(Plan {
        revision: crate::analysis::stable_id(
            &serde_json::to_string(graph).map_err(|e| e.to_string())?,
        ),
        removed_node_ids: graph
            .nodes
            .iter()
            .filter(|n| removed.contains(n.id.as_str()))
            .map(|n| n.id.clone())
            .collect(),
        removed_edge_ids: graph
            .edges
            .iter()
            .filter(|e| removed.contains(e.from.as_str()) || removed.contains(e.to.as_str()))
            .map(|e| e.id.clone())
            .collect(),
        preserved_shared_node_ids: graph
            .nodes
            .iter()
            .filter(|n| candidates.contains(n.id.as_str()) && kept.contains(n.id.as_str()))
            .map(|n| n.id.clone())
            .collect(),
        applied: false,
    })
}

pub fn apply(graph: &mut CallGraph, plan: &Plan) {
    let removed: HashSet<_> = plan.removed_node_ids.iter().collect();
    graph.nodes.retain(|n| !removed.contains(&n.id));
    graph
        .edges
        .retain(|e| !removed.contains(&e.from) && !removed.contains(&e.to));
    if let Some(report) = &mut graph.analysis {
        report.pending_nodes.retain(|id| !removed.contains(id));
        report.queried_nodes.retain(|id| !removed.contains(id));
        report.pruned_node_ids.extend(plan.removed_node_ids.clone());
        report.pruned_node_ids.sort();
        report.pruned_node_ids.dedup();
        report.issues.push(format!(
            "人工减枝排除 {} 个符号；当前图是经过裁剪的分析结果。",
            removed.len()
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn graph(pairs: &[(&str, &str)]) -> CallGraph {
        let mut ids = vec!["root"];
        for (a, b) in pairs {
            ids.extend([a, b]);
        }
        ids.sort();
        ids.dedup();
        serde_json::from_value(serde_json::json!({"schemaVersion":"0.4","projectId":"test","title":"test","root":"root",
          "nodes":ids.iter().map(|id|serde_json::json!({"id":id,"kind":"function","label":id,"file":"main.rs","line":1,"role":"test"})).collect::<Vec<_>>(),
          "edges":pairs.iter().enumerate().map(|(i,(a,b))|serde_json::json!({"id":i.to_string(),"from":a,"to":b,"kind":"static-call","file":"main.rs","line":1})).collect::<Vec<_>>()
        })).unwrap()
    }
    #[test]
    fn batch_prunes_shared_only_when_no_outside_reference_remains() {
        let g = graph(&[
            ("root", "a"),
            ("root", "b"),
            ("a", "c"),
            ("b", "c"),
            ("c", "d"),
            ("root", "x"),
            ("x", "d"),
        ]);
        let ids = vec!["a".into(), "b".into(), "a".into()];
        let p = plan_many(&g, &ids).unwrap();
        assert_eq!(p.removed_node_ids, vec!["a", "b", "c"]);
        assert_eq!(p.preserved_shared_node_ids, vec!["d"]);
        assert!(plan_many(&g, &[]).is_err());
        assert!(plan_many(&g, &["a".into(), "root".into()]).is_err());
        assert!(plan_many(&g, &["a".into(), "missing".into()]).is_err());
        let reversed = plan_many(&g, &["b".into(), "a".into()]).unwrap();
        assert_eq!(p.removed_node_ids, reversed.removed_node_ids);
        let mut cyclic = g.clone();
        cyclic.edges.push(serde_json::from_value(serde_json::json!({"id":"loop","from":"c","to":"root","kind":"static-call","file":"main.rs","line":1})).unwrap());
        assert!(
            !plan_many(&cyclic, &ids)
                .unwrap()
                .removed_node_ids
                .contains(&"root".to_owned())
        );
    }
    #[test]
    fn preserves_shared_descendants_and_unrelated_components() {
        let g = graph(&[
            ("root", "a"),
            ("root", "b"),
            ("a", "c"),
            ("b", "c"),
            ("c", "d"),
            ("a", "e"),
            ("x", "y"),
        ]);
        let p = plan(&g, "a").unwrap();
        assert_eq!(p.removed_node_ids, vec!["a", "e"]);
        assert_eq!(p.preserved_shared_node_ids, vec!["c", "d"]);
        let mut after = g;
        apply(&mut after, &p);
        assert!(after.nodes.iter().any(|n| n.id == "y"));
        assert!(after.edges.iter().all(|e| e.from != "a" && e.to != "a"));
    }
    #[test]
    fn cycles_do_not_delete_root_or_other_branch() {
        let g = graph(&[
            ("root", "a"),
            ("a", "b"),
            ("b", "a"),
            ("b", "root"),
            ("root", "c"),
        ]);
        assert_eq!(plan(&g, "a").unwrap().removed_node_ids, vec!["a", "b"]);
        assert!(plan(&g, "root").is_err());
        assert!(plan(&g, "missing").is_err());
        let mut changed = g.clone();
        changed.description = "changed".into();
        assert_ne!(
            plan(&g, "a").unwrap().revision,
            plan(&changed, "a").unwrap().revision
        );
    }
}
