"use server";

import { redirect } from "next/navigation";

import { isCalendarDate } from "../../../../lib/day-summary";

/** Validates the picked day and navigates; the page reads the figures from the API for that date. */
export async function selectSummaryDateAction(formData: FormData): Promise<void> {
  const date = formData.get("date");
  if (typeof date !== "string" || !isCalendarDate(date)) redirect("/app/reports/day?error=invalid_date");
  redirect(`/app/reports/day?date=${date}`);
}
