import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseEodWorkbook } from "@/lib/parseEodReport";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }

  let parsedReports;
  try {
    const buffer = await file.arrayBuffer();
    parsedReports = parseEodWorkbook(buffer);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to parse the file." },
      { status: 400 }
    );
  }

  const results: { reportDate: string; jobCount: number }[] = [];

  for (const parsed of parsedReports) {
    const { data: report, error: reportError } = await supabase
      .from("reports")
      .upsert(
        {
          report_date: parsed.reportDate,
          uploaded_by: user.id,
          total_profit: parsed.totals.total_profit ?? null,
          total_converted_jobs: parsed.totals.total_converted_jobs ?? null,
          total_job_amount: parsed.totals.total_job_amount ?? null,
          total_vendor_payment: parsed.totals.total_vendor_payment ?? null,
          total_refunded_to_client: parsed.totals.total_refunded_to_client ?? null,
          total_completed_jobs: parsed.totals.total_completed_jobs ?? null,
          total_cancelled_jobs: parsed.totals.total_cancelled_jobs ?? null,
          platform_breakdown: parsed.platformBreakdown,
        },
        { onConflict: "report_date" }
      )
      .select("id")
      .single();

    if (reportError || !report) {
      return NextResponse.json(
        { error: `Failed to save report for ${parsed.reportDate}: ${reportError?.message}` },
        { status: 500 }
      );
    }

    const { error: deleteError } = await supabase
      .from("jobs")
      .delete()
      .eq("report_id", report.id)
      .eq("source", "upload");

    if (deleteError) {
      return NextResponse.json(
        { error: `Failed to clear old job rows for ${parsed.reportDate}: ${deleteError.message}` },
        { status: 500 }
      );
    }

    const rows = parsed.jobs.map((j) => ({ ...j, report_id: report.id, source: "upload" }));
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error: insertError } = await supabase.from("jobs").insert(batch);
      if (insertError) {
        return NextResponse.json(
          { error: `Failed to save job rows for ${parsed.reportDate}: ${insertError.message}` },
          { status: 500 }
        );
      }
    }

    results.push({ reportDate: parsed.reportDate, jobCount: rows.length });
  }

  return NextResponse.json({ results });
}
