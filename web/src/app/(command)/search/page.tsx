import type { Metadata } from "next"; import { PeopleWorkspace } from "@/features/people/people-workspace";
export const metadata: Metadata = { title: "Search" }; export default function Page() { return <PeopleWorkspace mode="search" />; }
