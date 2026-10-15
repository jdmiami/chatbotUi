import { redirect } from 'next/navigation';

/** The workspace chooser now lives at "/". */
export default function DesktopIndex() {
  redirect('/?choose=1');
}
