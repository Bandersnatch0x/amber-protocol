"use strict";

const { createRequest } = require("../core/context-request");
const { ingestPayload } = require("../core/context-ingest");
const { verifyPages } = require("../core/context-verify");
const { refreshPages } = require("../core/context-refresh");
const { computeStats } = require("../core/context-stats");
const { listPages, readPage, deletePage } = require("../core/context-store");
const { describeKnowledge } = require("../core/context-knowledge");
const { buildLoadout, verifyLoadoutFile } = require("../core/context-loadout");
const { projectionStatus, rebuildProjection } = require("../core/context-projection");
const { runBenchmark } = require("../core/context-benchmark");
const { importSourceBundle, sourceTargetBinding } = require("../core/context-source-adapter");
const { retentionReport } = require("../core/context-retention");

module.exports = {
	createRequest,
	ingestPayload,
	verifyPages,
	refreshPages,
	computeStats,
	listPages,
	readPage,
	deletePage,
	describeKnowledge,
	buildLoadout,
	verifyLoadoutFile,
	projectionStatus,
	rebuildProjection,
	runBenchmark,
	importSourceBundle,
	sourceTargetBinding,
	retentionReport,
};
