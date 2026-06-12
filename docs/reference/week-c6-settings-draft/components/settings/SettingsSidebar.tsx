type Section = 'appearance' | 'notifications' | 'account';

interface SettingsSidebarProps {
  activeSection: Section;
  onSectionChange: (section: Section) => void;
}

const sections = [
  { id: 'appearance' as const, label: 'Appearance', icon: '🎨' },
  { id: 'notifications' as const, label: 'Notifications', icon: '🔔' },
  { id: 'account' as const, label: 'Account', icon: '👤' },
];

export function SettingsSidebar({ activeSection, onSectionChange }: SettingsSidebarProps) {
  return (
    <nav className="w-64 space-y-1" aria-label="Settings navigation">
      {sections.map((section) => (
        <button
          key={section.id}
          onClick={() => onSectionChange(section.id)}
          className={`w-full flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeSection === section.id
              ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
          aria-current={activeSection === section.id ? 'page' : undefined}
        >
          <span className="text-xl">{section.icon}</span>
          <span>{section.label}</span>
        </button>
      ))}
    </nav>
  );
}
