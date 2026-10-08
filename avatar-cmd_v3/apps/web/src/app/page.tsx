import { redirect } from "next/navigation";

// トップページはダッシュボードへ（未ログインならミドルウェアがログイン画面へ回す）
export default function Home() {
  redirect("/dashboard");
}
