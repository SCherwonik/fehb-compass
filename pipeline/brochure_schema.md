# Brochure extraction schema (v1)

Each brochure text file is `pipeline/raw/brochures_txt/2027/<N>.txt` (pages delimited by `=== PAGE n ===`).
One output file per brochure: `pipeline/raw/extractions/2027/<N>.json`.

## Rules
- Extract only what the brochure states. Never infer, never use outside knowledge. Missing -> `null` (or `[]`).
- Every fact carries `page` (the PAGE number it came from) and, for anything not a plain number, a short verbatim `quote` (max 300 chars).
- Money as numbers in USD (`"$30"` -> `30`), percentages as numbers (`"50%"` -> `50`) with a `unit` of `usd`|`pct`|`text`; keep `text` verbatim when it is not a clean number.
- A brochure covers several plan options (e.g. Standard Option and Basic Option; or several regional HMOs). Where a fact differs by option, make one entry per option, keyed by `option` (use the option names exactly as the brochure spells them).
- Output must be valid JSON, nothing else.

## Shape
```json
{
  "brochure": "73-891",
  "carrier": "string",
  "options": ["High Option", "Standard Option"],
  "changes_for_2027": [
    {"option": "all|<option>", "category": "premium|copay|deductible|oop_max|prescription|benefit_added|benefit_removed|network|other",
     "summary": "one sentence, plain words", "from": "string|null", "to": "string|null", "page": 12, "quote": "..."}
  ],
  "prescriptions": {
    "pbm_or_pharmacy_program": "name as stated|null",
    "formulary_name": "string|null",
    "formulary_url": "string|null",
    "drug_lookup_url": "string|null",
    "retail_network": "string|null",
    "mail_order": "string|null",
    "specialty_pharmacy": "string|null",
    "tiers": [
      {"option": "...", "tier": "Tier 1", "label": "generic|preferred brand|non-preferred brand|specialty|other",
       "retail_30": {"value": 10, "unit": "usd", "text": "$10 copayment", "page": 80},
       "retail_90": {"value": null, "unit": "text", "text": "...", "page": 80},
       "mail_90": {"value": 25, "unit": "usd", "text": "...", "page": 80},
       "deductible_applies": true,
       "notes": "string|null"}
    ],
    "rx_out_of_pocket_max": [{"option": "...", "text": "...", "value": 5000, "page": 79}],
    "prior_authorization": {"text": "...", "page": 83},
    "step_therapy": {"text": "...", "page": 83},
    "quantity_limits": {"text": "...", "page": 83},
    "generic_substitution_rules": "string|null",
    "preventive_drugs_free": {"text": "...", "page": 81},
    "glp1_weight_loss": {"covered": true, "text": "...", "page": 81},
    "glp1_diabetes": {"covered": true, "text": "...", "page": 81},
    "other_notable": ["string"]
  },
  "network": {
    "type": "PPO|HMO|EPO|POS|FFS|other",
    "name": "string|null",
    "directory_url": "string|null",
    "out_of_network": {"covered": true, "text": "...", "page": 20},
    "referrals_required": {"value": false, "text": "...", "page": 21},
    "service_area_text": "string|null"
  },
  "member_services": {"phone": "string|null", "website": "string|null", "telehealth": "string|null", "page": 3},
  "prior_approval_required": [{"service": "string", "text": "...", "page": 30}],
  "notable_limits_and_exclusions": [{"topic": "string", "text": "...", "page": 55}],
  "medicare_coordination_summary": {"text": "...", "page": 25},
  "extraction_notes": ["anything ambiguous or not found"]
}
```
