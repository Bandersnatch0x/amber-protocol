#!/usr/bin/env node
/**
 * Upper Shell CLI — consumes Amber MCP; never writes .amber/ directly.
 *
 *   upper-shell --target <repo> --objective "..."
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentLoop } from "./agent-loop.ts";
import { askYesNoCli, executeApprovedCommand } from "./approval-bridge.ts";
import { runHandoff } from "./handoff.ts";
import { AmberMcpClient, spawnAmberMcpTransport } from "./mcp-client.ts";
import { configFromEnv, createModelAdapter } from "./model-adapter.ts";
import { bindSession } from "./session-bind.ts";
import { ToolRegistry } from "./tool-registry.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface CliArgs {
	target: string;
	objective: string;
	maxTurns: number;
	agentId: string;
	amberRoot: string;
	execute: boolean;
	help: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
	const out: CliArgs = {
		target: "",
		objective: "",
		maxTurns: 12,
		agentId: "upper-shell",
		amberRoot: process.env.AMBER_ROOT
			? path.resolve(process.env.AMBER_ROOT)
			: path.resolve(__dirname, "..", ".."),
		execute: false,
		help: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--help" || a === "-h") out.help = true;
		else if (a === "--target") out.target = path.resolve(argv[++i] ?? "");
		else if (a === "--objective") out.objective = argv[++i] ?? "";
		else if (a === "--max-turns") out.maxTurns = Number(argv[++i] ?? "12");
		else if (a === "--agent-id") out.agentId = argv[++i] ?? "upper-shell";
		else if (a === "--amber-root") out.amberRoot = path.resolve(argv[++i] ?? "");
		else if (a === "--execute") out.execute = true;
		else if (a.startsWith("-")) throw new Error(`unknown option: ${a}`);
	}
	return out;
}

export function printHelp(): void {
	console.log(`Usage: upper-shell --target <repo> --objective "..." [options]

Options:
  --target <path>       Repository Amber should govern (required)
  --objective <text>    Goal for the agent loop (required)
  --max-turns <n>       Max model turns (default: 12)
  --agent-id <name>     Attribution id passed as _agent (default: upper-shell)
  --amber-root <path>   Path to amber-protocol root (default: parent of upper-shell/)
  --execute             Acknowledge MCP execution intent (mutations still need y/n)
  -h, --help            Show help

Env:
  OPENAI_API_KEY   (required for live runs)
  OPENAI_BASE_URL  (default https://api.openai.com/v1)
  OPENAI_MODEL     (default gpt-4o-mini)
  AMBER_ROOT       Override amber-protocol root
`);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
	let args: CliArgs;
	try {
		args = parseArgs(argv);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 2;
	}
	if (args.help) {
		printHelp();
		return 0;
	}
	if (!args.target || !args.objective.trim()) {
		console.error("--target and --objective are required");
		printHelp();
		return 2;
	}

	const model = createModelAdapter(configFromEnv());
	const { transport, child } = spawnAmberMcpTransport({
		amberRoot: args.amberRoot,
		target: args.target,
		execute: args.execute,
	});
	const client = new AmberMcpClient(transport);
	const ac = new AbortController();
	const onSig = () => ac.abort();
	process.on("SIGINT", onSig);
	process.on("SIGTERM", onSig);
	let exitCode = 0;

	try {
		await client.initialize();
		await client.ping();
		const registry = new ToolRegistry({
			client,
			target: args.target,
			agentId: args.agentId,
		});
		await registry.refresh();

		const session = await bindSession({
			registry,
			objective: args.objective,
			ask: askYesNoCli,
			amberRoot: args.amberRoot,
		});
		if (session.degraded) {
			console.error(`[upper-shell] session degraded: ${session.warning ?? "unknown"}`);
		} else {
			console.error(`[upper-shell] session bound: ${session.sessionId}`);
		}

		const result = await runAgentLoop({
			objective: args.objective,
			target: args.target,
			maxTurns: args.maxTurns,
			agentId: args.agentId,
			sessionId: session.sessionId,
			signal: ac.signal,
			systemPromptExtra: session.sessionId
				? `Bound Amber session id: ${session.sessionId}`
				: "No Amber session id (degraded mode).",
			chat: (p) =>
				model.chatCompletion({ ...p, stream: true }, (ev) => {
					if (ev.type === "text") process.stderr.write(ev.text);
				}),
			callTool: (name, toolArgs) => registry.callTool(name, toolArgs),
			listOpenAITools: () => registry.toOpenAITools(),
			ask: askYesNoCli,
			executeApprovedCommand: (payload) =>
				executeApprovedCommand(payload, { amberRoot: args.amberRoot }),
			onEvent: (ev) => {
				if (ev.type === "tool.call") console.error(`\n[tool] → ${ev.name}`);
				if (ev.type === "approval.required") {
					console.error(`[approval] required for ${ev.name}`);
				}
			},
		});

		const lastAssistant = [...result.messages].reverse().find((m) => m.role === "assistant");
		if (lastAssistant?.content) console.log(`\n${lastAssistant.content}`);
		console.error(`[upper-shell] stopped: ${result.stoppedReason}`);
		if (result.stoppedReason === "error") {
			console.error(`[upper-shell] error: ${result.error}`);
			exitCode = 1;
		}

		try {
			const handoff = await runHandoff({ amberRoot: args.amberRoot, target: args.target });
			console.error(
				`[handoff] bundle=${handoff.bundle.ok ? "ok" : "fail"} validate=${handoff.validate.ok ? "ok" : "fail"}`,
			);
		} catch (err) {
			console.error(`[handoff] skipped: ${err instanceof Error ? err.message : String(err)}`);
		}
	} catch (err) {
		console.error(`[upper-shell] fatal: ${err instanceof Error ? err.message : String(err)}`);
		exitCode = 1;
	} finally {
		process.off("SIGINT", onSig);
		process.off("SIGTERM", onSig);
		client.close();
		try {
			child.kill("SIGTERM");
		} catch {
			/* ignore */
		}
	}
	return exitCode;
}

const isEntry =
	Boolean(process.argv[1]) &&
	(path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
		process.argv[1].endsWith(`${path.sep}index.ts`) ||
		process.argv[1].endsWith(`${path.sep}upper-shell.mjs`));

if (isEntry) {
	main().then((code) => process.exit(code));
}
