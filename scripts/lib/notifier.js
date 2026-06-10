"use strict";

function formatNotification(eventType, data) {
	const templates = {
		session_completed: {
			subject: `Session completed: ${data.sessionId || "unknown"}`,
			body: `Session ${data.sessionId} has completed successfully.\n\nGoal: ${data.goal || "N/A"}\nStages: ${data.stagesCompleted || 0}`,
		},
		session_failed: {
			subject: `Session failed: ${data.sessionId || "unknown"}`,
			body: `Session ${data.sessionId} has failed.\n\nGoal: ${data.goal || "N/A"}\nError: ${data.error || "Unknown error"}`,
		},
		budget_warning: {
			subject: `Budget warning: ${data.sessionId || "unknown"}`,
			body: `Session ${data.sessionId} has used ${data.percentage}% of budget.\n\nUsed: ${data.used}\nTotal: ${data.total}`,
		},
		budget_exceeded: {
			subject: `Budget exceeded: ${data.sessionId || "unknown"}`,
			body: `Session ${data.sessionId} has exceeded its budget.\n\nUsed: ${data.used}\nTotal: ${data.total}`,
		},
		session_created: {
			subject: `Session created: ${data.sessionId || "unknown"}`,
			body: `New session ${data.sessionId} has been created.\n\nGoal: ${data.goal || "N/A"}`,
		},
	};

	return (
		templates[eventType] || {
			subject: `Event: ${eventType}`,
			body: JSON.stringify(data),
		}
	);
}

async function sendNotification(eventType, data, config, options = {}) {
	let sent = 0;

	if (config.email?.enabled && config.email.triggers?.includes(eventType)) {
		if (!options.dryRun) {
			await sendEmail(eventType, data, config.email);
		}
		sent++;
	}

	if (config.slack?.enabled && config.slack.triggers?.includes(eventType)) {
		if (!options.dryRun) {
			await sendSlack(eventType, data, config.slack);
		}
		sent++;
	}

	return { sent };
}

async function sendEmail(eventType, data, emailConfig) {
	let nodemailer;
	try {
		nodemailer = require("nodemailer");
	} catch {
		// nodemailer not installed - skip silently
		return;
	}

	const message = formatNotification(eventType, data);
	const transporter = nodemailer.createTransport({
		host: emailConfig.host || "smtp.gmail.com",
		port: emailConfig.port || 587,
		secure: false,
		auth: { user: emailConfig.user, pass: emailConfig.pass },
	});

	await transporter.sendMail({
		from: emailConfig.from || emailConfig.user,
		to: emailConfig.to,
		subject: message.subject,
		text: message.body,
	});
}

async function sendSlack(eventType, data, slackConfig) {
	const message = formatNotification(eventType, data);

	try {
		await fetch(slackConfig.webhook, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: `${message.subject}\n\n${message.body}` }),
		});
	} catch {
		// Slack webhook failed - skip silently
	}
}

module.exports = { sendNotification, formatNotification };
