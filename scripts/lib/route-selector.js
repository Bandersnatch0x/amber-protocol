"use strict";

// Compatibility re-export of route scoring helpers. The implementation now
// lives in route-journey-decision.js (G: removed split-module facade; the
// scoring algorithm and route metadata are co-located). Existing callers
// importing from route-selector.js continue to work unchanged.
const { selectRoute, scoreRoutes } = require("./route-journey-decision");

module.exports = { selectRoute, scoreRoutes };
