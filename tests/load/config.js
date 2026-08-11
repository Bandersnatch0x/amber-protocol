// Performance thresholds for load tests
module.exports = {
	sessionCreation: {
		// Maximum average time per session creation (ms)
		avgTimeLimit: 6000,

		// Minimum success rate
		minSuccessRate: 0.9,

		// Total sessions in sequential test
		totalSessions: 20,

		// Individual session timeout (ms)
		sessionTimeout: 10000,
	},

	timeline: {
		// Timeline write operations per second
		minWriteThroughput: 1000,

		// Timeline read operations per second
		minReadThroughput: 5000,
	},

	// CI-specific adjustments (25% slower thresholds)
	ci: {
		avgTimeLimit: 7500,
		sessionTimeout: 12500,
	},
};
