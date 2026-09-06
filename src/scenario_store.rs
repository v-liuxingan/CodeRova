use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::graph_store::GraphStore;
use crate::model::ArchitectureScenario;

const PARTICIPANT_KINDS: &[&str] = &["application", "broker", "external-system", "user"];
const STEP_KINDS: &[&str] = &[
    "entry",
    "operation",
    "message",
    "handler",
    "decision",
    "retry",
    "outcome",
    "external",
];
const LINK_KINDS: &[&str] = &[
    "call",
    "request",
    "publish",
    "route",
    "deliver",
    "consume",
    "reply",
    "retry",
    "timeout",
    "compensate",
    "state-dependency",
];

pub trait ScenarioStore: Send + Sync {
    fn list(&self) -> Result<Vec<(String, ArchitectureScenario)>, String>;
    fn load(&self, slug: &str) -> Result<ArchitectureScenario, String>;
}

#[derive(Debug, Clone)]
pub struct FileScenarioStore {
    root: PathBuf,
}

impl FileScenarioStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn index(&self) -> Result<BTreeMap<String, PathBuf>, String> {
        if !self.root.exists() {
            return Ok(BTreeMap::new());
        }
        let mut index = BTreeMap::new();
        for entry in fs::read_dir(&self.root)
            .map_err(|error| format!("无法读取场景目录 {}：{error}", self.root.display()))?
        {
            let path = entry
                .map_err(|error| format!("无法读取场景目录项：{error}"))?
                .path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let slug = path
                .file_stem()
                .and_then(|value| value.to_str())
                .ok_or_else(|| format!("场景文件名不是有效 UTF-8：{}", path.display()))?;
            validate_slug(slug)?;
            if index.insert(slug.to_owned(), path.clone()).is_some() {
                return Err(format!("架构场景 slug 重复：{slug}"));
            }
        }
        Ok(index)
    }
}

impl ScenarioStore for FileScenarioStore {
    fn list(&self) -> Result<Vec<(String, ArchitectureScenario)>, String> {
        self.index()?
            .into_iter()
            .map(|(slug, path)| read_scenario_file(&path).map(|scenario| (slug, scenario)))
            .collect()
    }

    fn load(&self, slug: &str) -> Result<ArchitectureScenario, String> {
        validate_slug(slug)?;
        let path = self
            .index()?
            .remove(slug)
            .ok_or_else(|| format!("架构场景不存在：{slug}"))?;
        read_scenario_file(&path)
    }
}

pub fn read_scenario_file(path: &Path) -> Result<ArchitectureScenario, String> {
    let content =
        fs::read(path).map_err(|error| format!("无法读取 {}：{error}", path.display()))?;
    let scenario = serde_json::from_slice::<ArchitectureScenario>(&content)
        .map_err(|error| format!("架构场景格式检查失败：{}：{error}", path.display()))?;
    validate_scenario(&scenario)?;
    Ok(scenario)
}

pub fn validate_scenario(scenario: &ArchitectureScenario) -> Result<(), String> {
    if scenario.schema_version != "1.0" {
        return Err("architecture scenario 的 schemaVersion 必须是 1.0".to_owned());
    }
    if scenario.title.trim().is_empty() || scenario.goal.trim().is_empty() {
        return Err("architecture scenario 的 title 和 goal 不能为空".to_owned());
    }
    let mut participants = HashSet::new();
    for participant in &scenario.participants {
        validate_id(&participant.id, "participant")?;
        if !participants.insert(participant.id.as_str()) {
            return Err(format!("participant id 重复：{}", participant.id));
        }
        if !PARTICIPANT_KINDS.contains(&participant.kind.as_str()) {
            return Err(format!("participant {} 的 kind 无效", participant.id));
        }
        if participant.label.trim().is_empty() {
            return Err(format!("participant {} 的 label 不能为空", participant.id));
        }
    }

    let mut steps = HashSet::new();
    for step in &scenario.steps {
        validate_id(&step.id, "step")?;
        if !steps.insert(step.id.as_str()) {
            return Err(format!("step id 重复：{}", step.id));
        }
        if !participants.contains(step.participant_id.as_str()) {
            return Err(format!("step {} 引用了不存在的 participant", step.id));
        }
        if !STEP_KINDS.contains(&step.kind.as_str()) || step.label.trim().is_empty() {
            return Err(format!("step {} 的 kind 或 label 无效", step.id));
        }
        for drilldown in &step.drilldowns {
            validate_id(&drilldown.project_id, "drilldown projectId")?;
            validate_id(&drilldown.graph_slug, "drilldown graphSlug")?;
            if drilldown.target_ids.is_empty()
                || drilldown
                    .target_ids
                    .iter()
                    .any(|target| target.trim().is_empty())
                || drilldown.purpose.trim().is_empty()
            {
                return Err(format!("step {} 的 drilldown 不完整", step.id));
            }
        }
    }

    let mut links = HashSet::new();
    for link in &scenario.links {
        validate_id(&link.id, "link")?;
        if !links.insert(link.id.as_str()) {
            return Err(format!("link id 重复：{}", link.id));
        }
        if !steps.contains(link.from.as_str()) || !steps.contains(link.to.as_str()) {
            return Err(format!("link {} 引用了不存在的 step", link.id));
        }
        if !LINK_KINDS.contains(&link.kind.as_str()) || !(0.0..=1.0).contains(&link.confidence) {
            return Err(format!("link {} 的 kind 或 confidence 无效", link.id));
        }
    }
    Ok(())
}

pub fn validate_scenario_drilldowns(
    scenario: &ArchitectureScenario,
    graph_store: &dyn GraphStore,
) -> Result<(), String> {
    for step in &scenario.steps {
        for drilldown in &step.drilldowns {
            let graph = graph_store.load(&drilldown.graph_slug)?;
            if graph.project_id != drilldown.project_id {
                return Err(format!(
                    "step {} 的 drilldown projectId 与调用图 {} 不一致",
                    step.id, drilldown.graph_slug
                ));
            }
            for target_id in &drilldown.target_ids {
                if !graph.nodes.iter().any(|node| node.id == *target_id)
                    && !graph.edges.iter().any(|edge| edge.id == *target_id)
                {
                    return Err(format!(
                        "step {} 的 drilldown 目标不存在：{}#{}",
                        step.id, drilldown.graph_slug, target_id
                    ));
                }
            }
        }
    }
    Ok(())
}

fn validate_id(value: &str, field: &str) -> Result<(), String> {
    if value.is_empty()
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(format!(
            "{field} 必须是非空的字母、数字、连字符或下划线组合"
        ));
    }
    Ok(())
}

fn validate_slug(slug: &str) -> Result<(), String> {
    validate_id(slug, "架构场景名称")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ScenarioLink, ScenarioParticipant, ScenarioStep};

    fn scenario() -> ArchitectureScenario {
        ArchitectureScenario {
            schema_version: "1.0".into(),
            title: "测试场景".into(),
            goal: "验证跨图下钻".into(),
            description: String::new(),
            participants: vec![ScenarioParticipant {
                id: "app".into(),
                kind: "application".into(),
                label: "应用".into(),
                description: String::new(),
            }],
            steps: vec![ScenarioStep {
                id: "entry".into(),
                participant_id: "app".into(),
                kind: "entry".into(),
                label: "入口".into(),
                summary: String::new(),
                drilldowns: Vec::new(),
            }],
            links: vec![ScenarioLink {
                id: "self".into(),
                from: "entry".into(),
                to: "entry".into(),
                kind: "call".into(),
                label: String::new(),
                summary: String::new(),
                condition: String::new(),
                confidence: 1.0,
            }],
        }
    }

    #[test]
    fn accepts_a_bounded_architecture_scenario() {
        validate_scenario(&scenario()).expect("valid scenario");
    }

    #[test]
    fn rejects_a_link_to_an_unknown_step() {
        let mut value = scenario();
        value.links[0].to = "missing".into();
        assert!(validate_scenario(&value).is_err());
    }
}
