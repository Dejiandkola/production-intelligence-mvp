import TailorPortalClient from './TailorPortalClient'

export default async function TailorAccessPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  return <TailorPortalClient accessToken={token} />
}
