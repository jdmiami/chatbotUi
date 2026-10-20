import { redirect } from 'next/navigation';

/** The desktops are apps in Orbit now. */
export default function DesktopIndex() {
  redirect('/orbit');
}
