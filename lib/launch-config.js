/* =====================================================================
   lib/launch-config.js

   The one place the launch lead-magnet is switched on. While ENABLED is false
   nothing is reachable: scripts/generate-launch-pages.js writes no page,
   nothing links to one, and /api/subscribe answers 503 {"error":"not_enabled"}.
   docs/launch-report.md is the checklist for turning it on.

   A value left at null is a decision not yet taken. scripts/check-launch-config.js
   fails if ENABLED is true while any value is null or malformed.

     EDITION_NAME     the report's name as the pages print it, e.g. the title of the edition
     REPORT_SLUG      the report page's path: /<REPORT_SLUG>, lowercase letters, digits and dashes
     FOUNDING_CAP     how many founding customers there will be (a whole number)
     END_DATE         last day founding terms are offered, YYYY-MM-DD; shown as static text, no timer
     PROVIDER_NAME    the email provider that runs the list and the double opt-in (named in the privacy addendum)
     CONSENT_VERSION  an identifier for the consent wording in force, e.g. its publication date; stored with every signup
   ===================================================================== */

'use strict';

module.exports = {
  ENABLED: false,
  EDITION_NAME: null,    // TODO: decide
  REPORT_SLUG: null,     // TODO: decide
  FOUNDING_CAP: null,    // TODO: decide
  END_DATE: null,        // TODO: decide (YYYY-MM-DD)
  PROVIDER_NAME: null,   // TODO: decide
  CONSENT_VERSION: null  // TODO: set when the privacy addendum is published
};
