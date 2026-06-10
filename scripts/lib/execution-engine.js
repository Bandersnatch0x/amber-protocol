"use strict";

const fs = require("fs");
const path = require("path");
const { executeStage } = require("./stage-executor");
const { checkGate, createGateContext } = require("./gate-handler");
const { BudgetTracker, estimateStageConsumption } = require("./budget-tracker");
const { TimelineWriter } = require("./timeline-writer");

async function executeSession(sessionDir, manifest, route, options = {}) {
	const timelinePath = path.join(sessionDir, "timeline.jsonl");
	const writer = new TimelineWriter(timelinePath);

	const tracker = new BudgetTracker(
		manifest.budget?.total || Infinity,
		manifest.budget?.used || 0,
	);

	let stagesCompleted = 0;
	const gatesMap = new Map((route.gates || []).map((g) => [g.id, g]));
	const manifestPath = path.join(sessionDir, "manifest.json");

	function persistBudget() {
		if (fs.existsSync(manifestPath)) {
			try {
				const currentManifest = JSON.parse(
					fs.readFileSync(manifestPath, "utf8"),
				);
				currentManifest.budget = tracker.toJSON();
				currentManifest.updatedAt = new Date().toISOString();
				fs.writeFileSync(
					manifestPath,
					JSON.stringify(currentManifest, null, 2),
				);
			} catch (err) {
				console.error(`Warning: failed to persist budget: ${err.message}`);
			}
		}
	}

	try {
		for (const stage of route.stages) {
			await writer.append({
				type: "stage_started",
				stage: stage.name,
				data: { displayName: stage.displayName },
			});

			const consumption = estimateStageConsumption(stage.name);
			const budgetResult = tracker.addConsumption(consumption);

			if (budgetResult.warning) {
				await writer.append({
					type: "budget_warning",
					data: {
						percentage: budgetResult.percentage,
						used: budgetResult.used,
						total: budgetResult.total,
					},
				});
			}

			if (budgetResult.exceeded) {
				await writer.append({
					type: "budget_exceeded",
					data: { used: budgetResult.used, total: budgetResult.total },
				});
				await writer.close();
				persistBudget();
				return { success: false, reason: "Budget exceeded", stagesCompleted };
			}

			const stageResult = await executeStage(stage, options);

			if (!stageResult.success) {
				await writer.append({
					type: "stage_failed",
					stage: stage.name,
					data: { error: stageResult.error },
				});
				await writer.close();
				persistBudget();
				return { success: false, reason: "Stage failed", stagesCompleted };
			}

			await writer.append({
				type: "stage_completed",
				stage: stage.name,
				data: { output: stageResult.output || stageResult.message },
			});

			stagesCompleted++;

			if (stage.gateAfter) {
				const gate = gatesMap.get(stage.gateAfter);
				if (gate) {
					await writer.append({
						type: "gate_triggered",
						data: { gateId: gate.id, type: gate.type },
					});

					const context = createGateContext(manifest);
					const gateResult = await checkGate(gate, context, options);

					if (gateResult.passed) {
						await writer.append({
							type: "gate_passed",
							data: { gateId: gate.id },
						});
					} else {
						await writer.append({
							type: "gate_failed",
							data: { gateId: gate.id, userInput: gateResult.userInput },
						});
						await writer.close();
						persistBudget();
						return { success: false, reason: "Gate rejected", stagesCompleted };
					}
				}
			}
		}

		await writer.close();
		persistBudget();
		return { success: true, stagesCompleted };
	} catch (error) {
		await writer.append({
			type: "error",
			data: { message: error.message, stack: error.stack },
		});
		await writer.close();
		throw error;
	}
}

module.exports = { executeSession };
