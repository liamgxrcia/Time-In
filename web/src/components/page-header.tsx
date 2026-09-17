export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <header className="mb-7 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between"><div className="max-w-3xl"><p className="eyebrow">{eyebrow}</p><h1 className="display mt-2 text-4xl font-medium leading-tight sm:text-5xl">{title}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted sm:text-base">{description}</p></div>{actions && <div className="flex flex-wrap gap-2">{actions}</div>}</header>;
}
