import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Patient Intake | Straight To The Point Dry Needling",
  description:
    "Complete your intake with Aria before your visit — no login required.",
};

export default function IntakeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
