use std::fs;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use codex_callgraph_visualizer::graph_store::read_graph_file;
use codex_callgraph_visualizer::navigation::{SourceNavigator, VscodeCommandNavigator};
use codex_callgraph_visualizer::server::serve;
use codex_callgraph_visualizer::validation::{resolve_source_path, validate_graph};

#[derive(Debug, Parser)]
#[command(version, about = "Codex 源码调用链可视化工具")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Debug, Subcommand)]
enum Commands {
    /// 启动本地可视化服务
    Serve {
        #[arg(long, default_value_t = 4317)]
        port: u16,
        #[arg(long, default_value = "127.0.0.1")]
        host: IpAddr,
        #[arg(long, default_value = "../codex")]
        source_root: PathBuf,
        #[arg(long, default_value = "E:/develop/utils/vs/bin/code.cmd")]
        code: PathBuf,
        #[arg(long, default_value = "graphs")]
        graphs: PathBuf,
        #[arg(long, default_value = "public")]
        public: PathBuf,
    },
    /// 校验调用图结构及源码位置
    Validate {
        graph: PathBuf,
        #[arg(long, default_value = "../codex")]
        source_root: PathBuf,
        /// 输出机器可读的 JSON 报告
        #[arg(long)]
        json: bool,
    },
    /// 在 VSCode 中打开一个节点或连线的源码位置
    Open {
        graph: PathBuf,
        #[arg(long, conflicts_with = "edge")]
        node: Option<String>,
        #[arg(long, conflicts_with = "node")]
        edge: Option<String>,
        #[arg(long, default_value = "../codex")]
        source_root: PathBuf,
        #[arg(long, default_value = "E:/develop/utils/vs/bin/code.cmd")]
        code: PathBuf,
    },
}

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "codex_callgraph_visualizer=info,tower_http=info".into()),
        )
        .init();

    let cli = Cli::parse();
    let result = match cli.command.unwrap_or(Commands::Serve {
        port: 4317,
        host: IpAddr::V4(Ipv4Addr::LOCALHOST),
        source_root: PathBuf::from("../codex"),
        code: PathBuf::from("E:/develop/utils/vs/bin/code.cmd"),
        graphs: PathBuf::from("graphs"),
        public: PathBuf::from("public"),
    }) {
        Commands::Serve {
            port,
            host,
            source_root,
            code,
            graphs,
            public,
        } => {
            let address = SocketAddr::new(host, port);
            serve(address, public, graphs, source_root, code).await
        }
        Commands::Validate {
            graph,
            source_root,
            json,
        } => validate_command(&graph, &source_root, json),
        Commands::Open {
            graph,
            node,
            edge,
            source_root,
            code,
        } => open_command(
            &graph,
            node.as_deref(),
            edge.as_deref(),
            &source_root,
            &code,
        ),
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

fn validate_command(graph_path: &Path, source_root: &Path, json: bool) -> Result<(), String> {
    let graph = read_graph_file(graph_path)?;
    let report = validate_graph(&graph, Some(source_root));
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&report)
                .map_err(|error| format!("无法生成校验报告：{error}"))?
        );
    } else {
        println!(
            "{} — {} 个节点，{} 条连线",
            graph.title,
            graph.nodes.len(),
            graph.edges.len()
        );
        for warning in &report.warnings {
            println!("warning: {warning}");
        }
        for error in &report.errors {
            println!("error: {error}");
        }
        if report.valid {
            println!(
                "校验通过：{} 个源码位置均有效",
                report.source_locations.len()
            );
        }
    }
    if report.valid {
        Ok(())
    } else {
        Err(format!("校验失败，共 {} 个错误", report.errors.len()))
    }
}

fn open_command(
    graph_path: &Path,
    node_id: Option<&str>,
    edge_id: Option<&str>,
    source_root: &Path,
    code: &Path,
) -> Result<(), String> {
    let graph = read_graph_file(graph_path)?;
    let (file, line) = match (node_id, edge_id) {
        (Some(id), None) => graph
            .nodes
            .iter()
            .find(|node| node.id == id)
            .map(|node| (node.file.as_str(), node.line))
            .ok_or_else(|| format!("节点不存在：{id}"))?,
        (None, Some(id)) => graph
            .edges
            .iter()
            .find(|edge| edge.id == id)
            .map(|edge| (edge.file.as_str(), edge.line))
            .ok_or_else(|| format!("连线不存在：{id}"))?,
        _ => return Err("必须且只能指定 --node 或 --edge".to_owned()),
    };
    let path = resolve_source_path(source_root, file)?;
    if fs::read_to_string(&path)
        .map(|content| line as usize > content.lines().count())
        .unwrap_or(true)
    {
        return Err(format!("源码行号无效：{}:{line}", path.display()));
    }
    VscodeCommandNavigator::new(code.to_owned()).open(&path, line)?;
    println!("已请求 VSCode 打开 {}:{line}", path.display());
    Ok(())
}
