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
    stop: &str,
) -> HashSet<&'a str> {
    let mut queue = seeds;
    let mut seen = HashSet::new();
    while let Some(id) = queue.pop() {
        if id == stop || !seen.insert(id) {
            continue;
        }
        if let Some(next) = edges.get(id) {
            queue.extend(next);
        }
    }
    seen
}

pub fn plan(graph: &CallGraph, id: &str) -> Result<Plan, String> {
    if id == graph.root {
        return Err("不能减枝图的根节点；整图删除请使用回收站".into());
    }
    let selected = graph
        .nodes
        .iter()
        .find(|n| n.id == id)
        .ok_or("节点不存在")?;
    let mut edges: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in &graph.edges {
        edges.entry(&edge.from).or_default().push(&edge.to);
    }
    let candidates = reachable(vec![&selected.id], &edges, &graph.root);
    let outside = graph
        .nodes
        .iter()
        .filter(|n| !candidates.contains(n.id.as_str()))
        .map(|n| n.id.as_str())
        .collect();
    let kept = reachable(outside, &edges, id);
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
