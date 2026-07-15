import { json, supabase } from "../_shared.js";
import { deleteReceipts, listReceiptPaths, parseReceiptNote } from "../_receipt.js";

function shanghaiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

async function cleanup(env) {
  const settings = await supabase(env, "activity_settings?select=*&id=eq.main&limit=1");
  const setting = settings[0];
  if (!setting?.ends_on) throw new Error("后台尚未设置活动结束日期。");
  const deleteOn = addDays(setting.ends_on, 30);
  const today = shanghaiDate();
  if (today < deleteOn) return { due: false, today, deleteOn, deletedFiles: 0, updatedCoupons: 0 };

  const coupons = await supabase(env, "coupons?select=id,note&note=not.is.null");
  const updates = [];
  const referencedPaths = [];
  for (const coupon of coupons) {
    const note = parseReceiptNote(coupon.note);
    if (!note.issueReceipt && !note.redeemReceipt) continue;
    if (note.issueReceipt?.path) referencedPaths.push(note.issueReceipt.path);
    if (note.redeemReceipt?.path) referencedPaths.push(note.redeemReceipt.path);
    updates.push({
      id: coupon.id,
      note: JSON.stringify({
        receiptConsentAt: note.receiptConsentAt || null,
        receiptsDeletedAt: new Date().toISOString(),
        receiptsDeletedReason: "activity_end_plus_30_days"
      })
    });
  }

  const paths = [...new Set([...(await listReceiptPaths(env)), ...referencedPaths])];
  let deletedFiles = 0;
  for (let index = 0; index < paths.length; index += 100) {
    const deleted = await deleteReceipts(env, paths.slice(index, index + 100));
    deletedFiles += deleted.length;
  }
  await supabase(env, "receipt_fingerprints?id=not.is.null", { method: "DELETE" });
  for (let index = 0; index < updates.length; index += 50) {
    await Promise.all(updates.slice(index, index + 50).map((item) => supabase(env, `coupons?id=eq.${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ note: item.note })
    })));
  }
  return { due: true, today, deleteOn, deletedFiles, updatedCoupons: updates.length, sweptOrphans: paths.length - new Set(referencedPaths).size };
}

export async function onRequestPost({ request, env }) {
  try {
    const key = request.headers.get("X-Cleanup-Key") || "";
    if (!env.ADMIN_PASSWORD || key !== env.ADMIN_PASSWORD) return json({ ok: false, message: "无权执行清理任务。" }, 401);
    return json({ ok: true, data: await cleanup(env) });
  } catch (err) {
    return json({ ok: false, message: err.message || "小票清理任务失败。" }, 400);
  }
}
