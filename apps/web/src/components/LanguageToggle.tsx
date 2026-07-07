import { useI18n } from '@/lib/i18n';

export function LanguageToggle() {
  const { language, setLanguage, t } = useI18n();
  const nextLanguage = language === 'en' ? 'zh-CN' : 'en';

  return (
    <button
      type="button"
      onClick={() => setLanguage(nextLanguage)}
      aria-label={t('language.switch')}
      title={language === 'en' ? t('language.switchToChinese') : t('language.switchToEnglish')}
      className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold tracking-wide text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      {language === 'en' ? t('language.nextChinese') : t('language.nextEnglish')}
    </button>
  );
}
