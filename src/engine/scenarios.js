// Annual usage scenarios. rxMonthly = generic (tier 1) prescriptions filled every month.
export const SCENARIOS = {
  healthy: { pcpVisits: 1, specialistVisits: 0, erVisits: 0, hospitalStays: 0, labs: 1, imaging: 0, rxMonthly: 0 },
  typical: { pcpVisits: 3, specialistVisits: 2, erVisits: 0, hospitalStays: 0, labs: 3, imaging: 1, rxMonthly: 1 },
  condition: { pcpVisits: 4, specialistVisits: 8, erVisits: 1, hospitalStays: 0, labs: 6, imaging: 3, rxMonthly: 3 },
  worst: { pcpVisits: 4, specialistVisits: 10, erVisits: 1, hospitalStays: 2, labs: 10, imaging: 4, rxMonthly: 4 },
};
