import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

export function Header() {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const navigate = useNavigate();

    const navItems = [
        { label: '首页', href: '#home' },
        { label: '功能特性', href: '#features' },
        { label: '作品案例', href: '#works' },
        { label: '定价方案', href: '#pricing' },
        { label: '帮助中心', href: '#help' }
    ];

    return (
        <header className="fixed top-0 left-0 right-0 z-50 bg-slate-950/80 backdrop-blur-md border-b border-indigo-500/20">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    {/* Logo */}
                    <div className="flex items-center gap-2 cursor-pointer animate-[fadeInLeft_0.6s_ease-out]">
                        <div className="w-8 h-8 bg-gradient-to-br from-violet-600 to-cyan-500 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(124,58,237,0.5)]">
                            <span className="text-white font-bold tracking-tighter text-xs">MC</span>
                        </div>
                        <span className="text-xl font-bold text-white tracking-wide">魔片漫创</span>
                    </div>

                    {/* Desktop Navigation */}
                    <nav className="hidden md:flex items-center gap-8">
                        {navItems.map((item, index) => (
                            <a
                                key={item.href}
                                href={item.href}
                                className="text-slate-300 hover:text-cyan-400 transition-colors font-medium cursor-pointer animate-[fadeInDown_0.5s_ease-out] opacity-0 [animation-fill-mode:forwards]"
                                style={{ animationDelay: `${index * 100}ms` }}
                            >
                                {item.label}
                            </a>
                        ))}
                    </nav>

                    {/* CTA Buttons */}
                    <div className="hidden md:flex items-center gap-4">
                        <Button variant="ghost" className="text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer">
                            登录
                        </Button>
                        <Button
                            className="bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 text-white shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_25px_rgba(6,182,212,0.5)] transition-all cursor-pointer border-0"
                            onClick={() => navigate('/home')}
                        >
                            免费试用
                        </Button>
                    </div>

                    {/* Mobile menu button */}
                    <button
                        className="md:hidden text-slate-300 hover:text-white cursor-pointer"
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                    >
                        {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                    </button>
                </div>

                {/* Mobile Navigation */}
                {isMenuOpen && (
                    <nav className="md:hidden py-4 border-t border-indigo-500/20 animate-[fadeIn_0.3s_ease-out]">
                        {navItems.map((item) => (
                            <a
                                key={item.href}
                                href={item.href}
                                className="block py-2 text-slate-300 hover:text-cyan-400 transition-colors cursor-pointer font-medium"
                                onClick={() => setIsMenuOpen(false)}
                            >
                                {item.label}
                            </a>
                        ))}
                        <div className="flex flex-col gap-2 mt-4">
                            <Button variant="outline" className="w-full border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer">
                                登录
                            </Button>
                            <Button
                                className="w-full bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 text-white shadow-[0_0_15px_rgba(6,182,212,0.3)] border-0 cursor-pointer"
                                onClick={() => navigate('/home')}
                            >
                                免费试用
                            </Button>
                        </div>
                    </nav>
                )}
            </div>
        </header>
    );
}
