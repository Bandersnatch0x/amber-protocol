"use strict";

// adoption-engine.js
// Consolidated business logic layer for all Adoption workflows.
// This is a transitional facade that will gradually absorb logic from 5 modules.
// Steps 2-6 will move functions here; Step 7 will delete the old modules.

// For now, re-export everything from the old modules to maintain compatibility
const metricsModule = require("./adoption-metrics");
const reportsModule = require("./adoption-reports");
const gateModule = require("./adoption-gate");
const bundleModule = require("./adoption-bundle");
const proposalsModule = require("./adoption-proposals");

module.exports = {
	// From adoption-metrics.js
	buildAdoptionAuditMetrics: metricsModule.buildAdoptionAuditMetrics,
	serializeAdoptionMetricsBlock: metricsModule.serializeAdoptionMetricsBlock,

	// From adoption-reports.js
	parseAdoptionReportMetadata: reportsModule.parseAdoptionReportMetadata,
	listAdoptionReports: reportsModule.listAdoptionReports,
	writeAdoptionReportsIndex: reportsModule.writeAdoptionReportsIndex,
	validateAdoptionReports: reportsModule.validateAdoptionReports,
	parseAdoptionReportForComparison: reportsModule.parseAdoptionReportForComparison,
	compareAdoptionReports: reportsModule.compareAdoptionReports,
	statusAdoptionReports: reportsModule.statusAdoptionReports,
	generateAdoptionReport: reportsModule.generateAdoptionReport,

	// From adoption-gate.js
	gateAdoptionReport: gateModule.gateAdoptionReport,

	// From adoption-bundle.js
	bundleAdoptionArtifacts: bundleModule.bundleAdoptionArtifacts,

	// From adoption-proposals.js
	writeAdoptionNextActions: proposalsModule.writeAdoptionNextActions,
	writeAdoptionDecisionRecord: proposalsModule.writeAdoptionDecisionRecord,
	writeAdoptionApplyPlan: proposalsModule.writeAdoptionApplyPlan,
	writeAdoptionSelectedFiles: proposalsModule.writeAdoptionSelectedFiles,
};
