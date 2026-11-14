// Every constant below is an ASSUMPTION, not plan data. They are exported so an
// "assumptions" UI can show (and eventually let users override) them.
// Prices are the plan's allowed amount per event, in USD.
export const ASSUMED_PRICES = {
  pcpVisit: 150, // Assumption: allowed amount for one primary care office visit.
  specialistVisit: 250, // Assumption: allowed amount for one specialist office visit.
  erVisit: 2200, // Assumption: allowed amount for one emergency room visit (facility + physician).
  inpatientStay: 30000, // Assumption: allowed amount for the facility portion of one inpatient hospital stay.
  surgery: 12000, // Assumption: allowed amount for the surgeon/professional fees of the procedure during a stay.
  lab: 100, // Assumption: allowed amount for one lab/X-ray service.
  imaging: 600, // Assumption: allowed amount for one advanced imaging study (MRI/CT).
  rxGenericFill: 20, // Assumption: allowed amount for one 30-day generic (tier 1) prescription fill.
};

// Assumption: usage model applies each hospital stay with one surgical procedure.
export const ASSUMPTIONS_NOTE =
  'Usage is converted to dollars with ASSUMED_PRICES; each hospital stay is assumed to include one surgical procedure.';
