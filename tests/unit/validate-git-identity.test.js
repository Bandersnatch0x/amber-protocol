"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	commitIdentities,
	currentIdentities,
	formatFailure,
	parseArgs,
	validateIdentities,
} = require("../../scripts/validate-git-identity");

const PRIMARY = {
	scope: "current commit",
	role: "author",
	name: "Bandersnatch0x",
	email: "xihalele@gmail.com",
};

test("accepts the repository identity and GitHub noreply identity", () => {
	const invalid = validateIdentities([
		PRIMARY,
		{
			...PRIMARY,
			role: "committer",
			email: "13325067+Bandersnatch0x@users.noreply.github.com",
		},
	]);

	assert.deepEqual(invalid, []);
});

test("rejects every unapproved name or email", () => {
	const wrongName = { ...PRIMARY, name: "Unexpected User" };
	const wrongEmail = { ...PRIMARY, email: "unexpected@example.com" };

	assert.deepEqual(validateIdentities([wrongName, wrongEmail]), [wrongName, wrongEmail]);
});

test("rejects known forbidden historical identities by name and email", () => {
	const forbidden = [
		{ ...PRIMARY, name: "wangbinyu", email: "wang.binyu31@iwhalecloud.com" },
		{ ...PRIMARY, name: "Test", email: "test@test.com" },
		{ ...PRIMARY, name: "summersong", email: "xihalele@gmail.com" },
		{ ...PRIMARY, name: "Bandersnatch0x", email: "wang.binyu31@iwhalecloud.com" },
	];

	assert.deepEqual(validateIdentities(forbidden), forbidden);
});

test("reads effective author and committer identities through the injected git runner", () => {
	const calls = [];
	const git = (args, cwd) => {
		calls.push({ args, cwd });
		return args[1] === "GIT_AUTHOR_IDENT"
			? "Bandersnatch0x <xihalele@gmail.com> 1784304000 +0800\n"
			: "Bandersnatch0x <13325067+Bandersnatch0x@users.noreply.github.com> 1784304000 +0800\n";
	};

	const identities = currentIdentities("C:/repo", git);

	assert.equal(identities[0].role, "author");
	assert.equal(identities[1].role, "committer");
	assert.deepEqual(calls, [
		{ args: ["var", "GIT_AUTHOR_IDENT"], cwd: "C:/repo" },
		{ args: ["var", "GIT_COMMITTER_IDENT"], cwd: "C:/repo" },
	]);
});

test("reads author and committer metadata for every commit in a revision", () => {
	const git = (args) => {
		assert.deepEqual(args, [
			"log",
			"--format=%H%x09%an%x09%ae%x09%cn%x09%ce",
			"base..head",
		]);
		return [
			"aaaa\tBandersnatch0x\txihalele@gmail.com\tBandersnatch0x\txihalele@gmail.com",
			"bbbb\tUnexpected User\tunexpected@example.com\tBandersnatch0x\txihalele@gmail.com",
		].join("\n");
	};

	const identities = commitIdentities("base..head", ".", git);

	assert.equal(identities.length, 4);
	assert.equal(identities[2].scope, "commit bbbb");
	assert.equal(validateIdentities(identities).length, 1);
});

test("single-commit mode limits git log to one revision", () => {
	const git = (args) => {
		assert.deepEqual(args, [
			"log",
			"--format=%H%x09%an%x09%ae%x09%cn%x09%ce",
			"-1",
			"headsha",
		]);
		return "headsha\tBandersnatch0x\txihalele@gmail.com\tBandersnatch0x\txihalele@gmail.com";
	};

	const identities = commitIdentities("headsha", ".", git, { single: true });

	assert.equal(identities.length, 2);
	assert.equal(identities[0].scope, "commit headsha");
	assert.deepEqual(validateIdentities(identities), []);
});

test("failure output identifies the commit role and exact remediation", () => {
	const output = formatFailure([
		{
			scope: "commit abc123",
			role: "author",
			name: "Unexpected User",
			email: "unexpected@example.com",
		},
	]);

	assert.match(output, /commit abc123 author/);
	assert.match(output, /git config --local user\.name "Bandersnatch0x"/);
	assert.match(output, /git config --local user\.email "xihalele@gmail\.com"/);
});

test("CLI arguments require one explicit revision value", () => {
	assert.deepEqual(parseArgs([]), { mode: "current" });
	assert.deepEqual(parseArgs(["--range", "base..head"]), {
		mode: "range",
		revision: "base..head",
	});
	assert.deepEqual(parseArgs(["--commit", "head"]), {
		mode: "commit",
		revision: "head",
	});
	assert.throws(() => parseArgs(["--range"]), /Usage:/);
	assert.throws(() => parseArgs(["--commit"]), /git log -1/);
});
