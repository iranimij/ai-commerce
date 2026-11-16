import { redirect } from 'next/navigation'

// The dashboard arrives in M1; until then the admin is the setup page.
export default function Home() {
  redirect('/setup')
}
