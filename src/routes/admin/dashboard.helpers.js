const formatDashboardSummary = async (db) => {
  const statusRows = await db("orders")
    .select("status")
    .count("id as count")
    .groupBy("status");

  const orders = {
    placed: 0,
    cancelled: 0,
    fulfilled: 0,
    total: 0,
  };
  for (const row of statusRows) {
    const status = row.status;
    if (orders.hasOwnProperty(status)) {
      orders[status] = Number(row.count);
    }
    orders.total += Number(row.count);
  }

  if (!orders.total) {
    const [{ total = 0 } = {}] = await db("orders").count("id as total");
    orders.total = Number(total);
  }

  const [{ gmvCents = 0 } = {}] = await db("orders")
    .where({ status: "fulfilled" })
    .sum("total_cents as gmvCents");

  const [{ buyersTotal = 0 } = {}] = await db("orders")
    .countDistinct("buyer_user_id as buyersTotal");

  const last7Rows = await db("orders")
    .select(
      db.raw("to_char(created_at::date, 'YYYY-MM-DD') as day"),
      db.raw("count(id) filter (where status = 'fulfilled') as fulfilledCount"),
      db.raw("coalesce(sum(total_cents) filter (where status = 'fulfilled'), 0) as gmvCents")
    )
    .where("created_at", ">=", db.raw("current_date - interval '6 days'"))
    .andWhere("status", "fulfilled")
    .groupBy("day")
    .orderBy("day", "desc");

  const dayMap = new Map();
  for (const row of last7Rows) {
    dayMap.set(row.day, {
      day: row.day,
      fulfilledCount: Number(row.fulfilledcount ?? row.fulfilledCount ?? 0),
      gmvCents: Number(row.gmvcents ?? row.gmvCents ?? 0),
    });
  }

  const last7Days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const day = date.toISOString().slice(0, 10);
    const existing = dayMap.get(day);
    last7Days.push(
      existing || {
        day,
        fulfilledCount: 0,
        gmvCents: 0,
      }
    );
  }

  return {
    orders,
    gmvCents: Number(gmvCents),
    buyers: { total: Number(buyersTotal) },
    last7Days,
  };
};

module.exports = {
  formatDashboardSummary,
};
