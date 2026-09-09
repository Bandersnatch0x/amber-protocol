/**
 * S6 — Approval Bridge: human y/n for approvalRequired mutating tools.
 * Never silently approves. On approve, spawn rendered commandArgv via amber.js.
 */
import readline from "node:readline";
import { spawn } from "node:child_process";
import path from "node:path";
import type { ApprovalRequiredPayload, AskFn, CaptureRun, McpToolCallResult } from "./types.ts";
import { enrichToolResult } from "./mcp-client.ts";

export async function askYesNoCli(prompt: string): Promise<boolean> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
	try {
		const answer: string = await new Promise((resolve) => {
			rl.question(`${prompt} [y/N] `, resolve);
		});
		return /^y(es)?$/i.test(answer.trim());
	} finally {
		rl.close();
	}
}

export function formatApprovalPrompt(payload: ApprovalRequiredPayload, toolName?: string): string {
	return [
		"--- Amber Approval Required ---",
		toolName ? `tool: ${toolName}` : null,
		payload.command ? `command: ${payload.command}` : null,
		payload.hint ? `hint: ${payload.hint}` : null,
		"Approve mutating Amber action?",
	]
		.filter(Boolean)
		.join("\n");
}

export async function requestApproval(
	payload: ApprovalRequiredPayload,
	ask?: AskFn,
	toolName?: string,
): Promise<{ approved: boolean }> {
	if (!ask) return { approved: false };
	const approved = await ask(formatApprovalPrompt(payload, toolName));
	return { approved: approved === true };
}

export async function executeApprovedCommand(
	payload: ApprovalRequiredPayload,
	opts: { amberRoot: string; nodeBin?: string; runFn?: CaptureRun },
): Promise<McpToolCallResult> {
	const argv = payload.commandArgv;
	if (!Array.isArray(argv) || argv.length === 0) {
		return failClosed("fail-closed: approvalRequired payload missing commandArgv");
	}

	const rest = argv[0] === "amber" || argv[0] === "coding-harness" ? argv.slice(1) : argv;
	const amberJs = path.join(opts.amberRoot, "scripts", "amber.js");
	const nodeBin = opts.nodeBin ?? process.execPath;
	const run = opts.runFn ?? runCapture;

	try {
		const { stdout, stderr, code } = await run(nodeBin, [amberJs, ...rest]);
		const text = stdout || stderr;
		return enrichToolResult({
			isError: code !== 0,
			content: [{ type: "text", text: text || `exit ${code}` }],
		});
	} catch (err) {
		return failClosed(err instanceof Error ? err.message : String(err));
	}
}

function failClosed(error: string): McpToolCallResult {
	const parsed = { error, approved: true, executed: false };
	return {
		isError: true,
		content: [{ type: "text", text: JSON.stringify(parsed) }],
		parsed,
	};
}

export function runCapture(
	bin: string,
	args: string[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
	return new Promise((resolve) => {
		try {
			const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (b) => {
				stdout += String(b);
			});
			child.stderr.on("data", (b) => {
				stderr += String(b);
			});
			child.on("close", (code) => resolve({ stdout, stderr, code }));
			child.on("error", (err) => resolve({ stdout: "", stderr: String(err), code: 1 }));
		} catch (err) {
			resolve({ stdout: "", stderr: String(err), code: 1 });
		}
	});
}
