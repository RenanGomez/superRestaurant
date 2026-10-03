import AppHomePage from "../../page";

export default async function EditTablesPage({ searchParams }: { readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>> }) {
  const params = await searchParams;
  return <AppHomePage searchParams={Promise.resolve({ ...params, edit: "1" })} />;
}
