"use strict";

const STAGE_ESTIMATES = {
	capture: 1000,
	plan: 2000,
	implement: 5000,
	verify: 500,
	review: 1000,
	reproduce: 1500,
	fix: 3000,
	characterize: 2000,
	refactor: 4000,
};

function estimateStageConsumption(stageName) {
	return STAGE_ESTIMATES[stageName] || 1000;
}

class BudgetTracker {
	constructor(total, used = 0) {
		this.total = total;
		this.used = used;
		this.warningEmitted = false;
	}

	getUsed() {
		return this.used;
	}

	getTotal() {
		return this.total;
	}

	getPercentage() {
		if (this.total === 0) return 100;
		return Math.floor((this.used / this.total) * 100);
	}

	addConsumption(amount) {
		this.used += amount;
		const percentage = this.getPercentage();

		const result = {
			used: this.used,
			total: this.total,
			percentage,
			warning: false,
			exceeded: false,
		};

		if (percentage >= 100) {
			result.exceeded = true;
		} else if (percentage >= 90 && !this.warningEmitted) {
			result.warning = true;
			this.warningEmitted = true;
		}

		return result;
	}

	toJSON() {
		return { total: this.total, used: this.used };
	}
}

module.exports = { BudgetTracker, estimateStageConsumption };
