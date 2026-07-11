import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "西宁城北吾悦广场暑期3楼特别活动",
  description: "3F电子券发券、核销与后台管理系统"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
