"use strict";

// Compatibility re-export of the journey registry and convenience helpers.
// The data, scoring algorithm, and entry points now co-locate in
// route-journey-decision.js (G: data was previously split from the functions
// over that data). Existing callers importing from journey-router.js continue
// to work unchanged.
const { JOURNEYS, routeJourney, nextObjectiveCommand } = require("./route-journey-decision");

module.exports = { JOURNEYS, routeJourney, nextObjectiveCommand };
