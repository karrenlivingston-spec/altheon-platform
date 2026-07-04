"""Structured Kinvent extraction — Dr. Sharpe full real-PDF session (LOW tier).

Real extraction via aps_verify_extraction.py (3-page Kinvent report):
- CMJ braking_rfd: L 2.40 / R 13.6 (82.4% asymmetry, left weaker)
- SJ propulsive_rfd: 20.7% asymmetry, right weaker (left > right)
Two disagreeing notable findings -> session tier LOW (matches Dr. West's clinical read:
propulsive RFD reverses direction vs braking RFD, suggesting different movement strategies).
"""

SHARPE_STRUCTURED: dict = {
    "patient_name": "Sharpe Dr.",
    "patient_dob": "12/28/1988",
    "session_date": "07/03/2026",
    "tests": [
        {
            "test_type": "CMJ",
            "metrics": [
                {
                    "metric_name": "jump_height",
                    "left_value": None,
                    "right_value": None,
                    "combined_value": 10.4,
                    "unit": "cm",
                    "asymmetry_pct": None,
                },
                {
                    "metric_name": "peak_force_relative",
                    "left_value": 0.897,
                    "right_value": 0.839,
                    "combined_value": None,
                    "unit": "kg/kg",
                    "asymmetry_pct": 6.5,
                },
                {
                    "metric_name": "peak_power_relative",
                    "left_value": 27.4,
                    "right_value": 26.8,
                    "combined_value": None,
                    "unit": "W/kg",
                    "asymmetry_pct": 2.2,
                },
                {
                    "metric_name": "braking_rfd",
                    "left_value": 2.40,
                    "right_value": 13.6,
                    "combined_value": None,
                    "unit": "kg/s",
                    "asymmetry_pct": 82.4,
                },
                {
                    "metric_name": "propulsive_rfd",
                    "left_value": 890.0,
                    "right_value": 850.0,
                    "combined_value": None,
                    "unit": "kg/s",
                    "asymmetry_pct": 4.5,
                },
                {
                    "metric_name": "rsi",
                    "left_value": 1.85,
                    "right_value": 1.80,
                    "combined_value": None,
                    "unit": None,
                    "asymmetry_pct": 2.7,
                },
                {
                    "metric_name": "peak_rfd",
                    "left_value": 4200.0,
                    "right_value": 4100.0,
                    "combined_value": None,
                    "unit": "kg/s",
                    "asymmetry_pct": 2.4,
                },
            ],
        },
        {
            "test_type": "SJ",
            "metrics": [
                {
                    "metric_name": "jump_height",
                    "left_value": None,
                    "right_value": None,
                    "combined_value": 8.2,
                    "unit": "cm",
                    "asymmetry_pct": None,
                },
                {
                    "metric_name": "peak_force_relative",
                    "left_value": 0.92,
                    "right_value": 0.88,
                    "combined_value": None,
                    "unit": "kg/kg",
                    "asymmetry_pct": 4.3,
                },
                {
                    "metric_name": "peak_power_relative",
                    "left_value": 24.5,
                    "right_value": 23.8,
                    "combined_value": None,
                    "unit": "W/kg",
                    "asymmetry_pct": 2.9,
                },
                {
                    "metric_name": "propulsive_rfd",
                    "left_value": 100.0,
                    "right_value": 79.3,
                    "combined_value": None,
                    "unit": "kg/s",
                    "asymmetry_pct": 20.7,
                },
            ],
        },
        {
            "test_type": "RJT",
            "metrics": [
                {
                    "metric_name": "number_of_jumps",
                    "left_value": None,
                    "right_value": None,
                    "combined_value": 10.0,
                    "unit": None,
                    "asymmetry_pct": None,
                },
                {
                    "metric_name": "height_average",
                    "left_value": None,
                    "right_value": None,
                    "combined_value": 13.9,
                    "unit": "cm",
                    "asymmetry_pct": None,
                },
                {
                    "metric_name": "duration",
                    "left_value": None,
                    "right_value": None,
                    "combined_value": 7.0,
                    "unit": "s",
                    "asymmetry_pct": None,
                },
                {
                    "metric_name": "pace",
                    "left_value": None,
                    "right_value": None,
                    "combined_value": 94.3,
                    "unit": None,
                    "asymmetry_pct": None,
                },
                {
                    "metric_name": "average_power",
                    "left_value": None,
                    "right_value": None,
                    "combined_value": 17.0,
                    "unit": "W/kg",
                    "asymmetry_pct": None,
                },
            ],
        },
        {
            "test_type": "MULTIPLE_JUMPS",
            "metrics": [
                {
                    "metric_name": "number_of_jumps",
                    "left_value": None,
                    "right_value": None,
                    "combined_value": 3.0,
                    "unit": None,
                    "asymmetry_pct": None,
                },
                {
                    "metric_name": "height_average",
                    "left_value": None,
                    "right_value": None,
                    "combined_value": 15.1,
                    "unit": "cm",
                    "asymmetry_pct": None,
                },
                {
                    "metric_name": "duration",
                    "left_value": None,
                    "right_value": None,
                    "combined_value": 3.0,
                    "unit": "s",
                    "asymmetry_pct": None,
                },
                {
                    "metric_name": "pace",
                    "left_value": None,
                    "right_value": None,
                    "combined_value": 60.0,
                    "unit": None,
                    "asymmetry_pct": None,
                },
                {
                    "metric_name": "average_power",
                    "left_value": None,
                    "right_value": None,
                    "combined_value": 13.0,
                    "unit": "W/kg",
                    "asymmetry_pct": None,
                },
            ],
        },
    ],
    "unparsed_sections": [],
}

# Single-notable session (isolated finding) — still a valid real-world scenario.
ISOLATED_SINGLE_NOTABLE: dict = {
    "patient_name": "Example Patient",
    "patient_dob": "",
    "session_date": "07/03/2026",
    "tests": [
        {
            "test_type": "CMJ",
            "metrics": [
                {
                    "metric_name": "braking_rfd",
                    "left_value": 2.40,
                    "right_value": 13.6,
                    "combined_value": None,
                    "unit": "kg/s",
                    "asymmetry_pct": 82.4,
                },
                {
                    "metric_name": "peak_force_relative",
                    "left_value": 0.897,
                    "right_value": 0.839,
                    "combined_value": None,
                    "unit": "kg/kg",
                    "asymmetry_pct": 6.5,
                },
            ],
        },
    ],
    "unparsed_sections": [],
}
