"""Structured Kinvent extraction — Dr. West real-PDF notable findings (8 total).

Right-side deficit cluster (6/8): CMJ braking_rfd, DJ peak_force, DJ peak_rfd,
SLDJ rsi, SLDJ peak_force, SLDJ peak_rfd.
Outliers (2/8): SLCMJ braking_rfd (left), SLDJ jump_height (left).
"""

WEST_STRUCTURED: dict = {
    "patient_name": "West Dr.",
    "patient_dob": "04/08/1985",
    "session_date": "07/03/2026",
    "tests": [
        {
            "test_type": "CMJ",
            "metrics": [
                {
                    "metric_name": "jump_height",
                    "left_value": None,
                    "right_value": None,
                    "combined_value": 36.6,
                    "unit": "cm",
                    "asymmetry_pct": None,
                },
                {
                    "metric_name": "peak_force_relative",
                    "left_value": 1.15,
                    "right_value": 1.16,
                    "combined_value": 2.31,
                    "unit": "kg/kg",
                    "asymmetry_pct": 0.9,
                },
                {
                    "metric_name": "braking_rfd",
                    "left_value": 86.7,
                    "right_value": 69.1,
                    "combined_value": 156.0,
                    "unit": "kg/s",
                    "asymmetry_pct": 20.3,
                },
            ],
        },
        {
            "test_type": "SLCMJ",
            "metrics": [
                {
                    "metric_name": "braking_rfd",
                    "left_value": 79.8,
                    "right_value": 167.0,
                    "combined_value": None,
                    "unit": "kg/s",
                    "asymmetry_pct": 52.3,
                },
            ],
        },
        {
            "test_type": "DJ",
            "metrics": [
                {
                    "metric_name": "peak_force_relative",
                    "left_value": 1.70,
                    "right_value": 1.37,
                    "combined_value": 3.07,
                    "unit": "kg/kg",
                    "asymmetry_pct": 19.6,
                },
                {
                    "metric_name": "peak_rfd",
                    "left_value": 1743.0,
                    "right_value": 1134.0,
                    "combined_value": 2878.0,
                    "unit": "kg/s",
                    "asymmetry_pct": 34.9,
                },
            ],
        },
        {
            "test_type": "SLDJ",
            "metrics": [
                {
                    "metric_name": "rsi",
                    "left_value": 1.01,
                    "right_value": 0.765,
                    "combined_value": None,
                    "unit": None,
                    "asymmetry_pct": 24.5,
                },
                {
                    "metric_name": "jump_height",
                    "left_value": 12.6,
                    "right_value": 16.2,
                    "combined_value": None,
                    "unit": "cm",
                    "asymmetry_pct": 22.7,
                },
                {
                    "metric_name": "peak_force_relative",
                    "left_value": 3.56,
                    "right_value": 2.50,
                    "combined_value": None,
                    "unit": "kg/kg",
                    "asymmetry_pct": 29.6,
                },
                {
                    "metric_name": "peak_rfd",
                    "left_value": 4685.0,
                    "right_value": 1440.0,
                    "combined_value": None,
                    "unit": "kg/s",
                    "asymmetry_pct": 69.3,
                },
            ],
        },
    ],
    "unparsed_sections": [],
}
