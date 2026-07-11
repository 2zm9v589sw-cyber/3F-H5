export type CouponStatus = "unused" | "used" | "expired";

export type ActivitySetting = {
  id: string;
  activity_name: string;
  benefit_text: string;
  default_valid_days: number;
  starts_on: string | null;
  ends_on: string | null;
  updated_at?: string;
};

export type Merchant = {
  id: string;
  shop_code: string;
  name: string;
  activity_content: string;
  category_key: string;
  category_name: string;
  is_guide_point: boolean;
  can_issue: boolean;
  can_redeem: boolean;
  active: boolean;
  sort_order: number;
};

export type CouponType = {
  id: string;
  code: "guide" | "repurchase" | string;
  name: string;
  redeem_scope: "guide_points" | "regular_merchants";
  active: boolean;
  sort_order: number;
};

export type ThresholdRule = {
  id: string;
  category_key: string;
  category_name: string;
  min_amount: number;
  active: boolean;
  sort_order: number;
};

export type Coupon = {
  id: string;
  code: string;
  coupon_type_id: string;
  coupon_type_code?: string;
  coupon_type_name?: string;
  source_merchant_id: string | null;
  source_label: string;
  benefit_text: string;
  start_date: string;
  end_date: string;
  status: CouponStatus;
  issued_amount: number | null;
  issued_category_key: string | null;
  issued_at: string;
  redeemed_at: string | null;
  redeem_merchant_id: string | null;
  redeem_point_label: string | null;
  redeem_amount: number | null;
  phone_last4: string | null;
  note: string | null;
};

export type BootstrapData = {
  setting: ActivitySetting;
  merchants: Merchant[];
  couponTypes: CouponType[];
  thresholdRules: ThresholdRule[];
};
