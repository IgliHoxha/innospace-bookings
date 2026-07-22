import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { queryBookings } from "@/lib/db";
import {
  getContactFromEnv,
  getPricingFromEnv,
  requireEnv,
} from "@/lib/env-app";
import DashboardClient from "./DashboardClient";
import { PAGE_SIZE, INITIAL_FILTER } from "@/lib/pagination";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!verifySessionToken(token)) {
    redirect("/login");
  }

  const initialData = await queryBookings({
    filter: INITIAL_FILTER,
    page: 1,
    pageSize: PAGE_SIZE,
  });
  return (
    <DashboardClient
      initialData={initialData}
      username={requireEnv("DASHBOARD_USERNAME")}
      pricing={getPricingFromEnv()}
      contact={getContactFromEnv()}
    />
  );
}
