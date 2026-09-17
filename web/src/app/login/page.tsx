import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginPage } from "@/features/auth/login-page";
export const metadata: Metadata = { title: "Sign in" };
export default function Page() { return <Suspense><LoginPage /></Suspense>; }
