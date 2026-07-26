"use strict";

const { resolveTarget } = require("./core/fs-utils");
const { buildContext, inferNextStep } = require("./core/lifecycle");
const { buildGovernanceReport } = require("./core/governance-report");

function focusLabel(focus) {
	if (focus.type === "session") return `session ${focus.id}`;
	if (focus.type === "feature") return `feature ${focus.id}`;
	return "project bootstrap";
}

function renderContext(focus) {
	const notes = [];
	if (focus.autoSelected) notes.push("auto-selected");
	if (focus.othersPending > 0) notes.push(`${focus.othersPending} other item(s) pending`);
	const suffix = notes.length > 0 ? ` (${notes.join("; ")})` : "";
	return `Context: ${focusLabel(focus)}${suffix}`;
}

function renderText(envelope) {
	const lines = [renderContext(envelope.focus)];
	if (envelope.complete || !envelope.nextStep) {
		lines.push("All lifecycle steps complete for this focus.");
	} else {
		const { label, why, remedy } = envelope.nextStep;
		lines.push(`Next step: ${label}`, `  Why: ${why}`, `  Run: ${remedy}`);
	}

	if (Array.isArray(envelope.governanceActions) && envelope.governanceActions.length > 0) {
		const action = envelope.governanceActions[0];
		lines.push("Governance action:");
		lines.push(`  [${action.severity}] ${action.id}: ${action.why}`);
		lines.push(`  Run: ${action.command}`);
	}

	return lines.join("\n");
}

function inferNext(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const targetDisplay = target || ".";
	const ctx = buildContext(targetRoot, { ...options, target: targetDisplay });
	const nextStep = inferNextStep(ctx);
	let governanceActions;
	try {
		governanceActions = buildGovernanceReport(targetRoot, { targetDisplay }).nextActions.slice(0, 3);
	} catch {
		governanceActions = [];
	}

	const envelope = {
		target,
		focus: {
			type: ctx.focus.type,
			id: ctx.focus.id,
			autoSelected: ctx.focus.autoSelected,
			othersPending: ctx.focus.othersPending,
		},
		nextStep: nextStep || null,
		governanceActions,
		complete: nextStep === null,
		errors: [],
		warnings: [],
	};
	envelope.text = renderText(envelope);
	return envelope;
}

module.exports = { inferNext, renderText, renderContext };
