import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Project Health Avatar Manager · Modular wardrobe', description: '16자세와 2가지 색상에 모자·상의·하의를 조합하는 햄스터 렌더러' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
