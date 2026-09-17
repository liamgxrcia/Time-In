import type { Metadata } from "next"; import { PeopleWorkspace } from "@/features/people/people-workspace";
export const metadata: Metadata = { title: "Client management" }; export default function Page() { return <PeopleWorkspace mode="clients" />; }
