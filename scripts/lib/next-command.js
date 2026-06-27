"use strict";

const { resolveTarget } = require("./core/fs-utils");
const { buildContext, inferNextStep } = require("./core/lifecycle");

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
	const header = renderContext(envelope.focus);
	if (envelope.complete || !envelope.nextStep) {
		return `${header}\n✓ All lifecycle steps complete for this focus.`;
	}
	const { label, why, remedy } = envelope.nextStep;
	return [header, `Next step: ${label}`, `  Why: ${why}`, `  Run: ${remedy}`].join("\n");
}

function inferNext(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const ctx = buildContext(targetRoot, { ...options, target: target || "." });
	const nextStep = inferNextStep(ctx);
	const envelope = {
		target,
		focus: {
			type: ctx.focus.type,
			id: ctx.focus.id,
			autoSelected: ctx.focus.autoSelected,
			othersPending: ctx.focus.othersPending,
		},
		nextStep: nextStep || null,
		complete: nextStep === null,
		errors: [],
		warnings: [],
	};
	envelope.text = renderText(envelope);
	return envelope;
}

module.exports = { inferNext, renderText, renderContext };
