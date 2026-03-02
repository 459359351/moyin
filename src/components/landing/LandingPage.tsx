import { Header } from './Header';
import { Hero } from './Hero';
import { Stats } from './Stats';
import { Features } from './Features';
import { Works } from './Works';
import { CTA } from './CTA';
import { Footer } from './Footer';
import './landing.css';

export function LandingPage() {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-50">
            <Header />
            <main>
                <Hero />
                <Stats />
                <Features />
                <Works />
                <CTA />
            </main>
            <Footer />
        </div>
    );
}
