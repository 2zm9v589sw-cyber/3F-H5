"use client";

import { useEffect, useState } from "react";
import type { ActivitySetting, Coupon, CouponType, Merchant, ThresholdRule } from "@/lib/types";

type AdminData = {
  setting: ActivitySetting;
  merchants: Merchant[];
  couponTypes: CouponType[];
  thresholdRules: ThresholdRule[];
  coupons: (Coupon & { computedStatus?: string })[];
};

const newId = () => crypto.randomUUID();

function boolText(v: boolean) {
  return v ? "是" : "否";
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [data, setData] = useState<AdminData | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    const res = await fetch("/api/admin/config");
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setLoggedIn(false);
      setMessage(json.message || "请先登录后台。");
      return;
    }
    setLoggedIn(true);
    setData(json);
    setMessage("");
  }

  useEffect(() => { load(); }, []);

  async function login() {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.message || "登录失败");
      return;
    }
    setPassword("");
    await load();
  }

  async function save() {
    if (!data) return;
    setMessage("正在保存...");
    const res = await fetch("/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.message || "保存失败");
      return;
    }
    setMessage("保存成功，商户端和顾客端会立即读取新规则。");
    await load();
  }

  function patchSetting(values: Partial<ActivitySetting>) {
    setData((prev) => prev ? { ...prev, setting: { ...prev.setting, ...values } } : prev);
  }

  function patchMerchant(id: string, values: Partial<Merchant>) {
    setData((prev) => prev ? { ...prev, merchants: prev.merchants.map((m) => m.id === id ? { ...m, ...values } : m) } : prev);
  }

  function patchCouponType(id: string, values: Partial<CouponType>) {
    setData((prev) => prev ? { ...prev, couponTypes: prev.couponTypes.map((t) => t.id === id ? { ...t, ...values } : t) } : prev);
  }

  function patchThreshold(id: string, values: Partial<ThresholdRule>) {
    setData((prev) => prev ? { ...prev, thresholdRules: prev.thresholdRules.map((r) => r.id === id ? { ...r, ...values } : r) } : prev);
  }

  function exportCsv() {
    if (!data) return;
    const headers = ["券码", "券类型", "来源", "发券消费金额", "状态", "有效期", "核销点位", "核销金额", "核销时间", "备注"];
    const rows = data.coupons.map((c) => [c.code, c.coupon_type_name, c.source_label, c.issued_amount, c.computedStatus || c.status, `${c.start_date}至${c.end_date}`, c.redeem_point_label, c.redeem_amount, c.redeemed_at, c.note]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = "3F电子券核销数据.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!loggedIn) {
    return (
      <main className="app">
        <section className="panel" style={{ maxWidth: 460, margin: "80px auto" }}>
          <h2>后台管理登录</h2>
          <label>管理员密码</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="输入后台密码" />
          <div className="toolbar"><button onClick={login}>登录</button></div>
          {message && <div className="alert bad">{message}</div>}
        </section>
      </main>
    );
  }

  if (!data) return <main className="app"><div className="alert">正在加载后台...</div></main>;

  const metrics = {
    total: data.coupons.length,
    unused: data.coupons.filter((c) => (c.computedStatus || c.status) === "unused").length,
    used: data.coupons.filter((c) => (c.computedStatus || c.status) === "used").length,
    expired: data.coupons.filter((c) => (c.computedStatus || c.status) === "expired").length,
    amount: data.coupons.reduce((sum, c) => sum + Number(c.redeem_amount || 0), 0)
  };

  return (
    <main className="app">
      <div className="topbar">
        <div className="brand"><h1>后台管理</h1><p>活动规则、商户、权益和核销数据</p></div>
        <div className="toolbar"><button className="green" onClick={save}>保存全部配置</button><button className="secondary" onClick={exportCsv}>导出核销CSV</button></div>
      </div>
      {message && <div className={`alert ${message.includes("成功") ? "ok" : ""}`}>{message}</div>}

      <section className="panel">
        <div className="section-title"><h2>活动基础配置</h2><span className="muted">修改后立即影响商户端新发券</span></div>
        <div className="grid">
          <div className="col-6"><label>活动名称</label><input value={data.setting.activity_name} onChange={(e) => patchSetting({ activity_name: e.target.value })} /></div>
          <div className="col-3"><label>默认有效天数</label><input type="number" min="0" value={data.setting.default_valid_days} onChange={(e) => patchSetting({ default_valid_days: Number(e.target.value) })} /></div>
          <div className="col-3"><label>活动结束日期</label><input type="date" value={data.setting.ends_on || ""} onChange={(e) => patchSetting({ ends_on: e.target.value })} /></div>
          <div className="col-12"><label>券面权益说明（固定不可由商户修改）</label><textarea rows={3} value={data.setting.benefit_text} onChange={(e) => patchSetting({ benefit_text: e.target.value })} /></div>
        </div>
      </section>

      <section className="panel">
        <div className="section-title"><h2>满额赠券条件</h2><button className="secondary" onClick={() => setData({ ...data, thresholdRules: [...data.thresholdRules, { id: newId(), category_key: "new", category_name: "新类别", min_amount: 0, active: true, sort_order: data.thresholdRules.length }] })}>新增条件</button></div>
        <div className="table-wrap"><table><thead><tr><th>类别编码</th><th>类别名称</th><th>满额金额</th><th>启用</th><th>操作</th></tr></thead><tbody>
          {data.thresholdRules.map((r) => <tr key={r.id}>
            <td><input value={r.category_key} onChange={(e) => patchThreshold(r.id, { category_key: e.target.value })} /></td>
            <td><input value={r.category_name} onChange={(e) => patchThreshold(r.id, { category_name: e.target.value })} /></td>
            <td><input type="number" value={r.min_amount} onChange={(e) => patchThreshold(r.id, { min_amount: Number(e.target.value) })} /></td>
            <td><select value={String(r.active)} onChange={(e) => patchThreshold(r.id, { active: e.target.value === "true" })}><option value="true">启用</option><option value="false">停用</option></select></td>
            <td><button className="red" onClick={() => setData({ ...data, thresholdRules: data.thresholdRules.filter((x) => x.id !== r.id) })}>删除</button></td>
          </tr>)}
        </tbody></table></div>
      </section>

      <section className="panel">
        <div className="section-title"><h2>券类型</h2><button className="secondary" onClick={() => setData({ ...data, couponTypes: [...data.couponTypes, { id: newId(), code: "new", name: "新券类型", redeem_scope: "regular_merchants", active: true, sort_order: data.couponTypes.length }] })}>新增券类型</button></div>
        <div className="table-wrap"><table><thead><tr><th>编码</th><th>名称</th><th>核销范围</th><th>启用</th><th>操作</th></tr></thead><tbody>
          {data.couponTypes.map((t) => <tr key={t.id}>
            <td><input value={t.code} onChange={(e) => patchCouponType(t.id, { code: e.target.value })} /></td>
            <td><input value={t.name} onChange={(e) => patchCouponType(t.id, { name: e.target.value })} /></td>
            <td><select value={t.redeem_scope} onChange={(e) => patchCouponType(t.id, { redeem_scope: e.target.value as CouponType["redeem_scope"] })}><option value="guide_points">仅亲子多经点位</option><option value="regular_merchants">正铺/主次力店</option></select></td>
            <td><select value={String(t.active)} onChange={(e) => patchCouponType(t.id, { active: e.target.value === "true" })}><option value="true">启用</option><option value="false">停用</option></select></td>
            <td><button className="red" onClick={() => setData({ ...data, couponTypes: data.couponTypes.filter((x) => x.id !== t.id) })}>删除</button></td>
          </tr>)}
        </tbody></table></div>
      </section>

      <section className="panel">
        <div className="section-title"><h2>商户/点位配置</h2><button className="secondary" onClick={() => setData({ ...data, merchants: [...data.merchants, { id: newId(), shop_code: "", name: "新商户", activity_content: "", category_key: "retail_kids", category_name: "儿童零售", is_guide_point: false, can_issue: true, can_redeem: true, active: true, sort_order: data.merchants.length }] })}>新增商户</button></div>
        <div className="table-wrap"><table><thead><tr><th>铺位号</th><th>商户名称</th><th>活动内容</th><th>类别</th><th>亲子多经</th><th>可发券</th><th>可核销</th><th>启用</th><th>操作</th></tr></thead><tbody>
          {data.merchants.map((m) => <tr key={m.id}>
            <td><input value={m.shop_code} onChange={(e) => patchMerchant(m.id, { shop_code: e.target.value })} /></td>
            <td><input value={m.name} onChange={(e) => patchMerchant(m.id, { name: e.target.value })} /></td>
            <td><textarea value={m.activity_content || ""} onChange={(e) => patchMerchant(m.id, { activity_content: e.target.value })} /></td>
            <td><input value={m.category_name} onChange={(e) => patchMerchant(m.id, { category_name: e.target.value })} /></td>
            <td><select value={String(m.is_guide_point)} onChange={(e) => patchMerchant(m.id, { is_guide_point: e.target.value === "true" })}><option value="true">是</option><option value="false">否</option></select></td>
            <td><select value={String(m.can_issue)} onChange={(e) => patchMerchant(m.id, { can_issue: e.target.value === "true" })}><option value="true">是</option><option value="false">否</option></select></td>
            <td><select value={String(m.can_redeem)} onChange={(e) => patchMerchant(m.id, { can_redeem: e.target.value === "true" })}><option value="true">是</option><option value="false">否</option></select></td>
            <td><select value={String(m.active)} onChange={(e) => patchMerchant(m.id, { active: e.target.value === "true" })}><option value="true">启用</option><option value="false">停用</option></select></td>
            <td><button className="red" onClick={() => setData({ ...data, merchants: data.merchants.filter((x) => x.id !== m.id) })}>删除</button></td>
          </tr>)}
        </tbody></table></div>
      </section>

      <section className="panel">
        <div className="section-title"><h2>核销数据</h2><span className="muted">状态以后台券码为准</span></div>
        <div className="metric-row">
          <div className="metric"><div className="label">总券数</div><div className="num">{metrics.total}</div></div>
          <div className="metric"><div className="label">未使用</div><div className="num">{metrics.unused}</div></div>
          <div className="metric"><div className="label">已核销</div><div className="num">{metrics.used}</div></div>
          <div className="metric"><div className="label">已过期</div><div className="num">{metrics.expired}</div></div>
          <div className="metric"><div className="label">核销金额</div><div className="num">{metrics.amount.toFixed(2)}</div></div>
        </div>
        <div className="table-wrap"><table><thead><tr><th>券码</th><th>券类型</th><th>来源</th><th>发券消费</th><th>状态</th><th>核销点位</th><th>核销金额</th><th>核销时间</th></tr></thead><tbody>
          {data.coupons.map((c) => <tr key={c.id}>
            <td>{c.code}</td><td>{c.coupon_type_name}</td><td>{c.source_label}</td><td>{c.issued_amount ?? ""}</td>
            <td><span className={`badge ${c.computedStatus || c.status}`}>{(c.computedStatus || c.status) === "used" ? "已使用" : (c.computedStatus || c.status) === "expired" ? "已过期" : "未使用"}</span></td>
            <td>{c.redeem_point_label}</td><td>{c.redeem_amount}</td><td>{c.redeemed_at}</td>
          </tr>)}
        </tbody></table></div>
      </section>
    </main>
  );
}
