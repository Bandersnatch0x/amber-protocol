> **Status**: ✅ COMPLETED — All tasks implemented and tested.\n>\n# Phase B RC — Week 10-11: Integration Testing + Beta User Feedback

**Target**: 2026-06-20 (RC1) → 2026-06-27 (GA-ready)
**Status**: COMPLETED
**Owner**: TBD

## Overview

Phase B RC validates production readiness through comprehensive integration testing, beta user validation, and final hardening. Week 10 focuses on automated integration/load/failure tests. Week 11 runs a structured beta program with external users and triages all findings.

## Success Criteria

- [ ] All integration test scenarios pass (100%)
- [ ] Load tests meet performance targets (100 sessions <10min, 10 concurrent, 1000-event timeline)
- [ ] Failure injection tests demonstrate graceful recovery (network, disk, corruption, kill -9)
- [ ] 2-3 beta users complete onboarding and submit feedback
- [ ] All P0/P1 bugs fixed
- [ ] Documentation complete and validated by beta users
- [ ] Performance profiling shows no regressions vs Alpha baseline

## File Structure

```
tests/integration/
  scenarios/
    e2e_feature_delivery_test.py
    e2e_bugfix_retry_test.py
    concurrent_sessions_test.py
    checkpoint_recovery_test.py
    autonomous_interactive_interop_test.py
  load/
    sequential_sessions_test.py
    concurrent_sessions_load_test.py
    timeline_throughput_test.py
    memory_leak_test.py
    disk_exhaustion_test.py
  failure_injection/
    network_failure_test.py
    disk_full_test.py
    corrupted_manifest_test.py
    stale_lock_cleanup_test.py
    process_kill_stages_test.py
docs/beta/
  onboarding.md
  feedback_form.md
  telemetry_spec.md
scripts/
  run_integration_suite.sh
  run_load_tests.sh
  run_failure_injection.sh
  profile_performance.sh
```

## Week 10: Integration Testing

### Task 1: End-to-End Scenario Tests

**File**: `tests/integration/scenarios/e2e_feature_delivery_test.py`

**TDD Steps**:

1. **RED**: Write test for complete feature delivery flow
   - [ ] Test captures user request "Add login page"
   - [ ] Test verifies plan generation with phases
   - [ ] Test confirms implementation (file writes)
   - [ ] Test runs verification (tests pass)
   - [ ] Test completes review stage
   - [ ] Assert final status == "completed"
   - [ ] Assert checkpoint saved at each boundary

2. **GREEN**: Implement flow orchestration
   - [ ] Create `IntegrationTestHarness` class
   - [ ] Implement `run_full_flow(request: str) -> SessionResult`
   - [ ] Add stage boundary checkpointing
   - [ ] Wire capture → plan → implement → verify → review

3. **REFACTOR**: Extract reusable test fixtures
   - [ ] Create `@pytest.fixture` for test harness
   - [ ] Extract assertion helpers (`assert_stage_completed`)
   - [ ] Add logging for stage transitions

**File**: `tests/integration/scenarios/e2e_bugfix_retry_test.py`

**TDD Steps**:

1. **RED**: Write test for bugfix with retry
   - [ ] Test captures "Fix TypeError in auth.py"
   - [ ] Test injects failing verification (tests fail)
   - [ ] Test verifies retry with revised implementation
   - [ ] Test confirms second verification passes
   - [ ] Assert retry count == 1
   - [ ] Assert final status == "completed"

2. **GREEN**: Implement retry logic
   - [ ] Add `max_retries` parameter to flow orchestration
   - [ ] Implement retry loop in verify stage
   - [ ] Track retry count in session state
   - [ ] Pass failure context to next implementation attempt

3. **REFACTOR**: Parameterize retry behavior
   - [ ] Extract `RetryConfig(max_attempts, backoff)`
   - [ ] Add retry metrics to session result
   - [ ] Log retry attempts with context

**File**: `tests/integration/scenarios/concurrent_sessions_test.py`

**TDD Steps**:

1. **RED**: Write test for concurrent sessions
   - [ ] Test spawns 3 sessions with different requests
   - [ ] Test runs sessions in parallel (threading/asyncio)
   - [ ] Test verifies no file conflicts (separate workdirs)
   - [ ] Test confirms all sessions complete successfully
   - [ ] Assert no shared state corruption

2. **GREEN**: Implement session isolation
   - [ ] Add `session_id` to all file paths
   - [ ] Create isolated workdir per session
   - [ ] Use process-level locks for shared resources
   - [ ] Ensure thread-safe session registry

3. **REFACTOR**: Extract concurrency helpers
   - [ ] Create `run_concurrent_sessions(requests: List[str])`
   - [ ] Add timeout handling for deadlock detection
   - [ ] Log concurrency metrics (wall time vs sum)

**File**: `tests/integration/scenarios/checkpoint_recovery_test.py`

**TDD Steps**:

1. **RED**: Write test for checkpoint recovery after kill -9
   - [ ] Test starts session with "Add feature X"
   - [ ] Test checkpoints after plan stage
   - [ ] Test kills process with `os.kill(pid, signal.SIGKILL)`
   - [ ] Test restarts session from checkpoint
   - [ ] Test resumes from implementation stage
   - [ ] Assert no data loss, no duplicate work

2. **GREEN**: Implement checkpoint recovery
   - [ ] Add `resume_from_checkpoint(session_id)` function
   - [ ] Load last valid checkpoint from disk
   - [ ] Restore session state (stage, context, results)
   - [ ] Skip completed stages, resume from next

3. **REFACTOR**: Harden checkpoint format
   - [ ] Add checksum validation to checkpoint files
   - [ ] Implement atomic checkpoint writes (tmp + rename)
   - [ ] Add rollback to previous checkpoint on corruption

**File**: `tests/integration/scenarios/autonomous_interactive_interop_test.py`

**TDD Steps**:

1. **RED**: Write test for autonomous + interactive mode interop
   - [ ] Test starts autonomous session "Refactor auth module"
   - [ ] Test pauses for user input at decision point
   - [ ] Test injects interactive choice via stdin mock
   - [ ] Test resumes autonomous execution
   - [ ] Assert correct mode transitions logged

2. **GREEN**: Implement mode switching
   - [ ] Add `pause_for_input(prompt: str) -> str` to session
   - [ ] Implement mode state machine (autonomous/interactive/paused)
   - [ ] Handle stdin/stdout correctly in both modes
   - [ ] Resume autonomous flow after interactive response

3. **REFACTOR**: Extract interaction protocol
   - [ ] Define `InteractionPoint(stage, prompt, validator)`
   - [ ] Add mode transition hooks for logging/telemetry
   - [ ] Test with multiple interaction points in sequence

---

### Task 2: Load and Stress Testing

**File**: `tests/integration/load/sequential_sessions_test.py`

**TDD Steps**:

1. **RED**: Write test for 100 sequential sessions <10min
   - [ ] Test runs 100 simple sessions ("Add comment to file")
   - [ ] Test measures total wall time
   - [ ] Test asserts wall_time < 600 seconds
   - [ ] Test verifies all sessions completed successfully

2. **GREEN**: Optimize session overhead
   - [ ] Profile session startup time
   - [ ] Cache route loading (shared across sessions)
   - [ ] Reuse worker process pool
   - [ ] Minimize disk I/O per session

3. **REFACTOR**: Add performance metrics
   - [ ] Log per-session timing (p50, p95, p99)
   - [ ] Track resource usage (CPU, memory)
   - [ ] Generate performance report

**File**: `tests/integration/load/concurrent_sessions_load_test.py`

**TDD Steps**:

1. **RED**: Write test for 10 concurrent sessions
   - [ ] Test runs 10 sessions in parallel (ThreadPoolExecutor)
   - [ ] Test uses different requests per session
   - [ ] Test asserts no conflicts (file locks, shared state)
   - [ ] Test verifies all 10 complete successfully
   - [ ] Test measures max concurrent resource usage

2. **GREEN**: Implement concurrency safety
   - [ ] Add file-level locking for shared resources
   - [ ] Ensure thread-safe timeline writes
   - [ ] Isolate per-session working directories
   - [ ] Use connection pooling for shared services

3. **REFACTOR**: Add concurrency metrics
   - [ ] Track lock contention (wait time)
   - [ ] Measure parallelism efficiency (speedup ratio)
   - [ ] Log resource contention events

**File**: `tests/integration/load/timeline_throughput_test.py`

**TDD Steps**:

1. **RED**: Write test for 1000-event timeline throughput
   - [ ] Test writes 1000 events sequentially
   - [ ] Test measures total write time
   - [ ] Test asserts throughput >= 100 events/sec
   - [ ] Test verifies all events readable after write

2. **GREEN**: Optimize timeline writes
   - [ ] Implement write batching (buffer 10 events)
   - [ ] Use async I/O for timeline appends
   - [ ] Minimize fsync calls (batch commit)
   - [ ] Profile and eliminate write bottlenecks

3. **REFACTOR**: Add throughput monitoring
   - [ ] Track events/sec over time (sliding window)
   - [ ] Log slow write warnings (>100ms)
   - [ ] Add timeline health metrics

**File**: `tests/integration/load/memory_leak_test.py`

**TDD Steps**:

1. **RED**: Write test for long-running daemon memory leaks
   - [ ] Test runs daemon for 1000 sessions
   - [ ] Test samples memory usage every 100 sessions
   - [ ] Test asserts memory growth <10% after warmup
   - [ ] Test verifies no file descriptor leaks

2. **GREEN**: Fix memory leaks
   - [ ] Profile memory usage with tracemalloc
   - [ ] Close file handles explicitly (context managers)
   - [ ] Clear session caches after completion
   - [ ] Release event loop resources properly

3. **REFACTOR**: Add leak detection
   - [ ] Implement `@pytest.fixture` for memory monitoring
   - [ ] Log top memory consumers per session
   - [ ] Add automatic leak detection in CI

**File**: `tests/integration/load/disk_exhaustion_test.py`

**TDD Steps**:

1. **RED**: Write test for disk space exhaustion handling
   - [ ] Test mocks disk full error during checkpoint write
   - [ ] Test verifies graceful error message
   - [ ] Test confirms session can resume after space freed
   - [ ] Test asserts no partial/corrupted checkpoint files

2. **GREEN**: Implement disk exhaustion handling
   - [ ] Catch `OSError: [Errno 28] No space left` during writes
   - [ ] Return user-friendly error message
   - [ ] Clean up partial writes on failure
   - [ ] Implement checkpoint write pre-flight check (free space)

3. **REFACTOR**: Add disk monitoring
   - [ ] Check free space before large writes
   - [ ] Log warnings at <1GB free space
   - [ ] Add disk usage metrics to telemetry

---

### Task 3: Failure Injection Testing

**File**: `tests/integration/failure_injection/network_failure_test.py`

**TDD Steps**:

1. **RED**: Write test for network failures during pack/skill download
   - [ ] Test mocks network timeout during pack download
   - [ ] Test verifies retry with exponential backoff
   - [ ] Test asserts eventual success after transient failure
   - [ ] Test mocks permanent failure (404)
   - [ ] Test verifies graceful error message and fallback

2. **GREEN**: Implement network retry logic
   - [ ] Add `@retry(max_attempts=3, backoff=exponential)` decorator
   - [ ] Wrap download calls with timeout handling
   - [ ] Implement fallback to cached/local packs
   - [ ] Return clear error for permanent failures

3. **REFACTOR**: Extract network resilience layer
   - [ ] Create `NetworkClient` with built-in retry
   - [ ] Add circuit breaker for repeated failures
   - [ ] Log network failure events for debugging

**File**: `tests/integration/failure_injection/disk_full_test.py`

**TDD Steps**:

1. **RED**: Write test for disk full during checkpoint write
   - [ ] Test mocks `OSError: [Errno 28]` during checkpoint save
   - [ ] Test verifies no corrupted checkpoint left on disk
   - [ ] Test confirms session state remains consistent
   - [ ] Test retries after space freed (user intervention)

2. **GREEN**: Implement atomic checkpoint writes
   - [ ] Write checkpoint to temp file first
   - [ ] Verify write succeeded (checksum)
   - [ ] Atomic rename to final checkpoint location
   - [ ] Rollback on failure (delete temp file)

3. **REFACTOR**: Add write failure recovery
   - [ ] Pre-flight check for sufficient disk space
   - [ ] Implement checkpoint write transaction log
   - [ ] Add automatic cleanup of orphaned temp files

**File**: `tests/integration/failure_injection/corrupted_manifest_test.py`

**TDD Steps**:

1. **RED**: Write test for corrupted manifest recovery
   - [ ] Test creates valid checkpoint with manifest
   - [ ] Test corrupts manifest JSON (truncate, invalid syntax)
   - [ ] Test attempts to resume session
   - [ ] Test verifies fallback to previous checkpoint
   - [ ] Test logs corruption event for debugging

2. **GREEN**: Implement manifest validation and recovery
   - [ ] Add JSON schema validation on manifest load
   - [ ] Implement checksum verification (SHA256)
   - [ ] Keep last N checkpoints for rollback (N=3)
   - [ ] Fallback to previous valid checkpoint on corruption

3. **REFACTOR**: Harden checkpoint integrity
   - [ ] Add version field to manifest schema
   - [ ] Implement forward/backward compatibility checks
   - [ ] Log all checkpoint validation failures

**File**: `tests/integration/failure_injection/stale_lock_cleanup_test.py`

**TDD Steps**:

1. **RED**: Write test for stale lock file cleanup
   - [ ] Test creates lock file with PID of dead process
   - [ ] Test attempts to start new session
   - [ ] Test verifies stale lock detected and removed
   - [ ] Test confirms new session acquires lock successfully

2. **GREEN**: Implement stale lock detection
   - [ ] Read PID from lock file
   - [ ] Check if process exists (`os.kill(pid, 0)`)
   - [ ] Remove lock if process dead
   - [ ] Acquire lock for current session

3. **REFACTOR**: Add lock health monitoring
   - [ ] Log lock acquisition/release events
   - [ ] Track lock hold duration (warn if >1 hour)
   - [ ] Add automatic lock expiration (timeout)

**File**: `tests/integration/failure_injection/process_kill_stages_test.py`

**TDD Steps**:

1. **RED**: Write test for process kill at every stage boundary
   - [ ] Test kills process after capture stage
   - [ ] Test kills process after plan stage
   - [ ] Test kills process after implement stage
   - [ ] Test kills process after verify stage
   - [ ] Test resumes from each checkpoint successfully
   - [ ] Assert no duplicate work, no data loss

2. **GREEN**: Implement robust checkpoint boundaries
   - [ ] Add checkpoint save at end of each stage
   - [ ] Verify checkpoint integrity before proceeding
   - [ ] Skip completed stages on resume
   - [ ] Handle mid-stage kills (rollback to last checkpoint)

3. **REFACTOR**: Add stage transition safety
   - [ ] Implement two-phase commit for stage transitions
   - [ ] Log stage entry/exit for debugging
   - [ ] Add recovery smoke test after resume

---

### Task 4: Integration Test Infrastructure

**File**: `scripts/run_integration_suite.sh`

**TDD Steps**:

1. **RED**: Write script to run all integration tests
   - [ ] Script discovers all test files in `tests/integration/scenarios/`
   - [ ] Script runs tests with pytest
   - [ ] Script collects coverage report
   - [ ] Script generates HTML report
   - [ ] Script exits with failure if any test fails

2. **GREEN**: Implement test runner
   - [ ] Use `pytest tests/integration/scenarios/ --cov --cov-report=html`
   - [ ] Add test result summary (passed/failed counts)
   - [ ] Generate JUnit XML for CI integration
   - [ ] Set timeout for entire suite (30min)

3. **REFACTOR**: Add CI integration
   - [ ] Add GitHub Actions workflow file
   - [ ] Run integration tests on PR
   - [ ] Upload test artifacts (reports, logs)
   - [ ] Add badge to README

**File**: `scripts/run_load_tests.sh`

**TDD Steps**:

1. **RED**: Write script to run load tests
   - [ ] Script runs sequential sessions test
   - [ ] Script runs concurrent sessions test
   - [ ] Script runs timeline throughput test
   - [ ] Script runs memory leak test
   - [ ] Script collects performance metrics
   - [ ] Script fails if any target missed

2. **GREEN**: Implement load test runner
   - [ ] Run `pytest tests/integration/load/ -v`
   - [ ] Parse performance metrics from test output
   - [ ] Compare against baseline targets
   - [ ] Generate performance report (CSV + charts)

3. **REFACTOR**: Add performance tracking
   - [ ] Store historical performance data
   - [ ] Detect regressions (>10% slowdown)
   - [ ] Generate trend charts (gnuplot/matplotlib)

**File**: `scripts/run_failure_injection.sh`

**TDD Steps**:

1. **RED**: Write script to run failure injection tests
   - [ ] Script runs network failure tests
   - [ ] Script runs disk failure tests
   - [ ] Script runs corruption tests
   - [ ] Script runs lock tests
   - [ ] Script runs process kill tests
   - [ ] Script verifies all recovery paths tested

2. **GREEN**: Implement failure injection runner
   - [ ] Run `pytest tests/integration/failure_injection/ -v`
   - [ ] Log all injected failures and recovery actions
   - [ ] Verify no unhandled exceptions
   - [ ] Check test coverage of error paths

3. **REFACTOR**: Add chaos testing
   - [ ] Randomize failure timing
   - [ ] Combine multiple failure types
   - [ ] Run extended chaos test (1000 iterations)

---

## Week 11: Beta User Program

### Task 5: Beta User Setup

**File**: `docs/beta/onboarding.md`

**TDD Steps**:

1. **RED**: Write onboarding documentation
   - [ ] Document: Installation instructions (pip/brew/npm)
   - [ ] Document: Quick start tutorial (3 examples)
   - [ ] Document: Configuration guide (settings.json)
   - [ ] Document: Troubleshooting common issues
   - [ ] Document: How to submit feedback

2. **GREEN**: Create onboarding materials
   - [ ] Write installation guide with verification steps
   - [ ] Create 3 example workflows (feature, bugfix, refactor)
   - [ ] Document configuration options with defaults
   - [ ] Add FAQ section based on Alpha/Beta feedback
   - [ ] Include contact info (email, Slack, GitHub issues)

3. **REFACTOR**: Validate with test user
   - [ ] Run through onboarding with fresh user
   - [ ] Time to first successful session (<15min goal)
   - [ ] Fix unclear/missing steps
   - [ ] Add screenshots/videos if needed

**File**: `docs/beta/feedback_form.md`

**TDD Steps**:

1. **RED**: Write feedback collection form
   - [ ] Form section: Overall experience (1-5 scale)
   - [ ] Form section: Most useful feature
   - [ ] Form section: Most frustrating issue
   - [ ] Form section: Feature requests
   - [ ] Form section: Bug reports
   - [ ] Form section: Performance feedback
   - [ ] Form section: Documentation quality

2. **GREEN**: Create structured feedback form
   - [ ] Use Google Forms or TypeForm
   - [ ] Include both quantitative (ratings) and qualitative (text)
   - [ ] Add optional usage consent checkbox
   - [ ] Link to GitHub issue template for bugs

3. **REFACTOR**: Set up feedback pipeline
   - [ ] Create Slack channel for beta feedback
   - [ ] Set up form submission notifications
   - [ ] Create spreadsheet for tracking feedback

**File**: `docs/beta/telemetry_spec.md`

**TDD Steps**:

1. **RED**: Write telemetry specification (opt-in)
   - [ ] Spec: Events to track (session start/end, stage transitions, errors)
   - [ ] Spec: Metrics to collect (timing, resource usage, success rate)
   - [ ] Spec: Privacy policy (no user code, no PII)
   - [ ] Spec: Opt-in mechanism (explicit consent)
   - [ ] Spec: Data retention (30 days)

2. **GREEN**: Implement telemetry collection
   - [ ] Add `telemetry_enabled` flag to config
   - [ ] Implement event tracking (send to local log first)
   - [ ] Add privacy filters (strip file paths, user names)
   - [ ] Create telemetry aggregation script

3. **REFACTOR**: Add telemetry dashboard
   - [ ] Create simple web dashboard (Flask/Streamlit)
   - [ ] Show aggregated metrics (no individual user data)
   - [ ] Add export to CSV for analysis

---

### Task 6: Beta User Recruitment and Execution

**File**: `scripts/recruit_beta_users.sh`

**TDD Steps**:

1. **RED**: Write beta user recruitment process
   - [ ] Identify target users (3-5 developers)
   - [ ] Send recruitment email with onboarding link
   - [ ] Schedule kickoff call (30min)
   - [ ] Set expectations (1 week testing period)
   - [ ] Provide feedback form link

2. **GREEN**: Execute recruitment
   - [ ] Draft recruitment email template
   - [ ] Send to candidate list
   - [ ] Schedule kickoff calls
   - [ ] Send onboarding materials
   - [ ] Create beta user Slack channel

3. **REFACTOR**: Track beta user progress
   - [ ] Create tracking spreadsheet (user, status, issues found)
   - [ ] Send daily check-in messages
   - [ ] Offer 1-on-1 support calls
   - [ ] Collect feedback after 1 week

---

### Task 7: Bug Triage and Fixes

**File**: `docs/beta/bug_triage_process.md`

**TDD Steps**:

1. **RED**: Write bug triage process
   - [ ] Define priority levels (P0: blocker, P1: critical, P2: nice-to-have)
   - [ ] Define SLA per priority (P0: same day, P1: 2 days, P2: backlog)
   - [ ] Create triage checklist (reproducible? impact? workaround?)
   - [ ] Define escalation path (when to involve architect/security)

2. **GREEN**: Implement triage workflow
   - [ ] Create GitHub issue template for bugs
   - [ ] Add priority labels (P0, P1, P2)
   - [ ] Create triage meeting cadence (daily during beta)
   - [ ] Assign owner for each bug

3. **REFACTOR**: Track bug metrics
   - [ ] Count bugs by priority
   - [ ] Measure time-to-fix per priority
   - [ ] Track regression rate (fixed bugs reopened)

**File**: `scripts/fix_p0_bugs.sh`

**TDD Steps**:

1. **RED**: Write P0 bug fix workflow
   - [ ] Test: Identify P0 bug from issue tracker
   - [ ] Test: Reproduce bug locally
   - [ ] Test: Write failing test that captures bug
   - [ ] Test: Fix implementation
   - [ ] Test: Verify fix with test
   - [ ] Test: Deploy fix to beta users
   - [ ] Test: Confirm fix with reporter

2. **GREEN**: Implement P0 fix pipeline
   - [ ] Create hotfix branch for P0 bugs
   - [ ] Run full test suite after fix
   - [ ] Fast-track code review (1 approver)
   - [ ] Deploy to beta environment immediately
   - [ ] Notify affected users via Slack/email

3. **REFACTOR**: Add fix validation
   - [ ] Run integration tests before deploy
   - [ ] Add regression test to test suite
   - [ ] Update documentation if needed

**File**: `scripts/ux_improvements.sh`

**TDD Steps**:

1. **RED**: Write UX improvement workflow based on feedback
   - [ ] Analyze feedback for common pain points
   - [ ] Prioritize improvements (quick wins vs long-term)
   - [ ] Create issue for each improvement
   - [ ] Estimate effort (small/medium/large)

2. **GREEN**: Implement top 3 UX improvements
   - [ ] Improvement 1: Better error messages (add context, suggestions)
   - [ ] Improvement 2: Progress indicators (show stage transitions)
   - [ ] Improvement 3: Interactive mode prompts (clearer, more helpful)
   - [ ] Test each improvement with beta users

3. **REFACTOR**: Validate improvements
   - [ ] Collect feedback on improvements
   - [ ] Measure impact (reduced errors, faster sessions)
   - [ ] Document UX patterns for future development

---

### Task 8: Performance Tuning

**File**: `scripts/profile_performance.sh`

**TDD Steps**:

1. **RED**: Write performance profiling script
   - [ ] Profile session startup time (target <1s)
   - [ ] Profile route loading (target <500ms)
   - [ ] Profile timeline writes (target <10ms per event)
   - [ ] Profile stage transitions (target <100ms)
   - [ ] Identify top 3 bottlenecks

2. **GREEN**: Run profiling and identify hotspots
   - [ ] Use `cProfile` or `py-spy` for Python profiling
   - [ ] Generate flamegraph for visualization
   - [ ] Identify slow functions (>100ms)
   - [ ] Analyze I/O vs CPU time
   - [ ] Document bottlenecks with evidence

3. **REFACTOR**: Create optimization plan
   - [ ] Rank optimizations by impact (% speedup)
   - [ ] Estimate effort for each optimization
   - [ ] Create GitHub issues for top optimizations

**File**: `src/optimizations/route_cache.py`

**TDD Steps**:

1. **RED**: Write test for route loading cache
   - [ ] Test: First route load takes >500ms
   - [ ] Test: Second route load takes <50ms (cached)
   - [ ] Test: Cache invalidated on route file change
   - [ ] Test: Cache shared across sessions

2. **GREEN**: Implement route loading cache
   - [ ] Add in-memory cache with LRU eviction
   - [ ] Cache parsed route definitions
   - [ ] Watch route files for changes (invalidate on change)
   - [ ] Measure speedup (baseline vs cached)

3. **REFACTOR**: Add cache metrics
   - [ ] Track cache hit rate
   - [ ] Log cache size and evictions
   - [ ] Add cache warming on daemon startup

**File**: `src/optimizations/timeline_writer_batch.py`

**TDD Steps**:

1. **RED**: Write test for batched timeline writes
   - [ ] Test: Single write takes ~10ms
   - [ ] Test: 10 buffered writes complete in <50ms total
   - [ ] Test: Buffer flushes on timeout (100ms)
   - [ ] Test: Buffer flushes on process exit (no data loss)

2. **GREEN**: Implement write batching
   - [ ] Add write buffer (list of events)
   - [ ] Flush buffer every 100ms or 10 events
   - [ ] Flush on session end
   - [ ] Use `atexit` hook for process exit flush

3. **REFACTOR**: Add batching metrics
   - [ ] Track average batch size
   - [ ] Measure write latency reduction
   - [ ] Log flush events for debugging

**File**: `src/optimizations/parallel_stages.py`

**TDD Steps**:

1. **RED**: Write test for parallelizing independent stages
   - [ ] Test: Sequential execution takes 10s
   - [ ] Test: Parallel execution takes 6s (40% speedup)
   - [ ] Test: Results identical to sequential
   - [ ] Test: Error in one stage doesn't block others

2. **GREEN**: Implement parallel stage execution
   - [ ] Identify independent stages (can run in parallel)
   - [ ] Use `ThreadPoolExecutor` or `asyncio.gather`
   - [ ] Collect results from parallel stages
   - [ ] Handle errors gracefully (partial success)

3. **REFACTOR**: Add parallelism metrics
   - [ ] Measure speedup ratio (parallel/sequential)
   - [ ] Track resource utilization (CPU, memory)
   - [ ] Log parallel execution events

---

### Task 9: Documentation Completeness

**File**: `docs/beta/documentation_audit.md`

**TDD Steps**:

1. **RED**: Write documentation audit checklist
   - [ ] Audit: Installation guide complete and accurate?
   - [ ] Audit: API reference complete?
   - [ ] Audit: Configuration options documented?
   - [ ] Audit: Troubleshooting guide covers common issues?
   - [ ] Audit: Examples cover key use cases?
   - [ ] Audit: Migration guide from Alpha to Beta?

2. **GREEN**: Complete documentation gaps
   - [ ] Add missing API documentation
   - [ ] Expand troubleshooting guide with beta issues
   - [ ] Add 5 more examples (edge cases, advanced usage)
   - [ ] Create migration guide (breaking changes, new features)

3. **REFACTOR**: Validate with beta users
   - [ ] Ask beta users to review documentation
   - [ ] Collect feedback on clarity and completeness
   - [ ] Fix unclear/incorrect documentation
   - [ ] Add FAQ section based on common questions

---

### Task 10: GA Readiness Checklist

**File**: `docs/beta/ga_readiness_checklist.md`

**TDD Steps**:

1. **RED**: Write GA readiness criteria
   - [ ] All P0/P1 bugs fixed
   - [ ] All integration tests passing (100%)
   - [ ] Load tests meet performance targets
   - [ ] Failure injection tests demonstrate recovery
   - [ ] Beta users report positive experience (>4/5)
   - [ ] Documentation complete and validated
   - [ ] Security review completed (no CRITICAL issues)
   - [ ] Performance profiling shows no regressions
   - [ ] Migration guide available
   - [ ] Release notes drafted

2. **GREEN**: Execute GA readiness verification
   - [ ] Run full test suite (unit + integration + load)
   - [ ] Review all open issues (close or defer)
   - [ ] Collect final beta user feedback
   - [ ] Complete security review
   - [ ] Run performance benchmarks
   - [ ] Validate documentation with fresh user

3. **REFACTOR**: Create GA release artifacts
   - [ ] Draft release notes (features, fixes, breaking changes)
   - [ ] Tag GA release version (v1.0.0)
   - [ ] Build release binaries/packages
   - [ ] Publish to package registries (PyPI, npm, etc.)
   - [ ] Announce GA on blog/social media

---

## Acceptance Criteria Mapping

| Task | Acceptance Criteria | Validation Method |
|------|-------------------|-------------------|
| Task 1: E2E Scenarios | All 5 scenario tests pass | `pytest tests/integration/scenarios/` |
| Task 2: Load Testing | 100 sessions <10min, 10 concurrent, 1000 events, no leaks | `./scripts/run_load_tests.sh` |
| Task 3: Failure Injection | All 5 failure tests demonstrate recovery | `./scripts/run_failure_injection.sh` |
| Task 4: Test Infrastructure | CI runs all tests on PR, coverage >80% | Check GitHub Actions |
| Task 5: Beta Setup | Onboarding doc complete, feedback form live, telemetry opt-in | Manual review with test user |
| Task 6: Beta Execution | 2-3 users complete 1-week testing, submit feedback | Track in spreadsheet |
| Task 7: Bug Triage | All P0/P1 bugs fixed, P2 backlog documented | Review GitHub issues |
| Task 8: Performance | Profile identifies bottlenecks, top 3 optimizations implemented | `./scripts/profile_performance.sh` |
| Task 9: Documentation | Audit complete, gaps filled, validated by beta users | Beta user feedback |
| Task 10: GA Readiness | All checklist items verified, release artifacts ready | Manual review + test suite |

---

## Summary

**Total Tasks**: 10
- Task 1: End-to-End Scenario Tests (5 test files, 15 TDD steps)
- Task 2: Load and Stress Testing (5 test files, 15 TDD steps)
- Task 3: Failure Injection Testing (5 test files, 15 TDD steps)
- Task 4: Integration Test Infrastructure (3 scripts, 9 TDD steps)
- Task 5: Beta User Setup (3 docs, 9 TDD steps)
- Task 6: Beta User Recruitment and Execution (1 script, 3 TDD steps)
- Task 7: Bug Triage and Fixes (3 files, 9 TDD steps)
- Task 8: Performance Tuning (4 files, 12 TDD steps)
- Task 9: Documentation Completeness (1 audit doc, 3 TDD steps)
- Task 10: GA Readiness Checklist (1 checklist doc, 3 TDD steps)

**Total TDD Steps**: 93 (31 RED, 31 GREEN, 31 REFACTOR)

**Total Files Created**: 30
- 15 test files (`tests/integration/scenarios/`, `tests/integration/load/`, `tests/integration/failure_injection/`)
- 6 script files (`scripts/`)
- 5 documentation files (`docs/beta/`)
- 4 optimization implementation files (`src/optimizations/`)

**Key Milestones**:
- Week 10 Day 3: All integration tests passing
- Week 10 Day 5: All load tests passing
- Week 11 Day 1: Beta users onboarded
- Week 11 Day 3: All P0/P1 bugs triaged
- Week 11 Day 5: GA readiness verified
- Week 11 Day 7: RC1 tagged and ready for GA

**Dependencies**:
- Phase B Alpha/Beta completion (Week 1-9)
- Beta user availability (2-3 volunteers)
- CI/CD infrastructure (GitHub Actions)
- Package registry access (PyPI, npm, etc.)

**Risks**:
- Beta users may find critical bugs late (mitigation: early recruitment)
- Performance targets may require architectural changes (mitigation: profile early)
- Documentation gaps may delay GA (mitigation: continuous validation)

**Success Metrics**:
- Test coverage: >80%
- Beta user satisfaction: >4/5
- Performance: 100 sessions <10min, 10 concurrent no conflicts
- Bug count: Zero P0/P1 open issues
- Documentation: 100% audit checklist complete
