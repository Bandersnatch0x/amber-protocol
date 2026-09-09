/**
 * S7 — Best-effort `amber handoff bundle` + `handoff validate`.
 * Failures are logged in the result; they never throw.
 */
import { runCapture } from "./approval-bridge.ts";
import type { CaptureRun } from "./types.ts";
import path from "node:path";

export interface HandoffStep {
	ok: boolean;
	stdout: string;
	stderr: string;
	code: number | null;
}

export interface HandoffResult {
	bundle: HandoffStep;
	validate: HandoffStep;
}

export async function runHandoff(opts: {
	amberRoot: string;
	target: string;
	nodeBin?: string;
	runFn?: CaptureRun;
}): Promise<HandoffResult> {
	const amberJs = path.join(opts.amberRoot, "scripts", "amber.js");
	const nodeBin = opts.nodeBin ?? process.execPath;
	const run = opts.runFn ?? runCapture;
	const bundle = await safeRun(run, nodeBin, [
		amberJs,
		"handoff",
		"bundle",
		"--target",
		opts.target,
	]);
	const validate = await safeRun(run, nodeBin, [
		amberJs,
		"handoff",
		"validate",
		"--target",
		opts.target,
	]);
	return { bundle, validate };
}

async function safeRun(run: CaptureRun, bin: string, args: string[]): Promise<HandoffStep> {
	try {
		const r = await run(bin, args);
		return { ...r, ok: r.code === 0 };
	} catch (err) {
		return { ok: false, stdout: "", stderr: String(err), code: 1 };
	}
}
