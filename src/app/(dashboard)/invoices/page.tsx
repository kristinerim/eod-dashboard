import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import InvoicesTable, { type Invoice } from "./InvoicesTable";

function formatCurrency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-black/10 p-3">
      <div className="text-xs text-black/50">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
    </div>
  );
}

export default async function InvoicesPage() {
  const supabase = await createClient();
  const invoiceList = await fetchAllRows<Invoice>(() =>
    supabase.from("invoices").select("*").order("created_at", { ascending: false })
  );

  const jobIds = invoiceList.map((i) => i.job_id);
  const jobs = await fetchAllRows<{ id: string; report_id: string }>(() =>
    supabase
      .from("jobs")
      .select("id, report_id")
      .in("id", jobIds.length > 0 ? jobIds : [""])
  );
  const reportIdByJobId = Object.fromEntries(jobs.map((j) => [j.id, j.report_id]));

  const totalInvoiced = invoiceList.reduce((sum, i) => sum + (i.amount ?? 0), 0);
  const totalPaid = invoiceList.reduce((sum, i) => sum + (i.amount_paid ?? 0), 0);
  const outstanding = invoiceList
    .filter((i) => i.status !== "Voided" && i.status !== "Refunded")
    .reduce((sum, i) => sum + Math.max((i.amount ?? 0) - (i.amount_paid ?? 0), 0), 0);

  return (
    <div className="space-y-8">
      <RealtimeRefresh tables={["invoices"]} />

      <h1 className="text-lg font-semibold">Invoices</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Total invoices" value={invoiceList.length} />
        <Card label="Total invoiced" value={formatCurrency(totalInvoiced)} />
        <Card label="Total paid" value={formatCurrency(totalPaid)} />
        <Card label="Outstanding" value={formatCurrency(outstanding)} />
      </div>

      <InvoicesTable invoices={invoiceList} reportIdByJobId={reportIdByJobId} />
    </div>
  );
}
