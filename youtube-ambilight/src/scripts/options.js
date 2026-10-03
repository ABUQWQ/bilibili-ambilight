import { defaultCrashOptions, storage } from './libs/storage';
import { syncStorage } from './libs/sync-storage';
import { getFeedbackFormLink, getPrivacyPolicyLink } from './libs/utils';
import SettingsConfig from './libs/settings-config';
import { on } from './libs/generic';

document.querySelector('#feedbackFormLink').href = getFeedbackFormLink();
document.querySelector('#privacyPolicyLink').href = getPrivacyPolicyLink();

let crashOptions;

const updateCrashReportOptions = () => {
  document.querySelector('[name="video"]').disabled = true;
  document.querySelector('[name="technical"]').disabled = true;
  document.querySelector('[name="crash"]').disabled = true;
  document.querySelector('[name="crash"]').checked = crashOptions.crash;
  document.querySelector('[name="technical"]').checked =
    crashOptions.crash && crashOptions.technical;
  document.querySelector('[name="video"]').checked =
    crashOptions.crash && crashOptions.video;
};

const checkboxInputs = document.querySelectorAll('[type="checkbox"]');
for (const input of checkboxInputs) {
  input.addEventListener('change', async () => {
    try {
      crashOptions[input.name] = input.checked;
      await storage.set('crashOptions', crashOptions);
    } catch {
      alert(
        '崩溃报告选项更改过于频繁，请等待几秒后重试。'
      );
      input.checked = !input.checked;
      crashOptions[input.name] = input.checked;
    }
    updateCrashReportOptions();
  });
}
(async function initCrashReportOptions() {
  crashOptions = (await storage.get('crashOptions')) || defaultCrashOptions;
  updateCrashReportOptions();
})();
const toggles = document.querySelectorAll('.expandable__toggle');
for (const elem of toggles) {
  on(elem, 'click', () => {
    elem.closest('.expandable').classList.toggle('expanded');
  });
}

if (!chrome?.storage?.local?.onChanged) {
  const synchronizationWarning = document.createElement('div');
  synchronizationWarning.textContent =
    '无法将崩溃报告选项同步到已打开的 YouTube 页面。此版本已禁用崩溃上报。';
  synchronizationWarning.classList.add('warning');
  document
    .querySelector('.warnings-container')
    .appendChild(synchronizationWarning);
}

const importExportStatus = document.querySelector('#importExportStatus');
const importExportStatusDetails = document.querySelector(
  '#importExportStatusDetails'
);
let importWarnings = [];
const importSettings = async (storageName, importJson) => {
  try {
    importExportStatus.textContent = '';
    importExportStatus.classList.remove('has-error');
    importExportStatusDetails.textContent = '';
    importExportStatusDetails.scrollTo(0, 0);

    const jsonString = await importJson();
    if (!jsonString) throw new Error('未找到可导入的设置');

    let importedObject = JSON.parse(jsonString);
    if (typeof importedObject !== 'object')
      throw new Error('未找到可导入的设置');

    // Temporarely import the setting blur as blur2
    // https://github.com/WesselKroos/youtube-ambilight/issues/191#issuecomment-1703792823
    if ('blur' in importedObject) {
      importedObject.blur2 = importedObject.blur;
      delete importedObject.blur;
    }

    importedObject = Object.keys(importedObject)
      .sort()
      .reduce((obj, key) => ((obj[key] = importedObject[key]), obj), {});

    const settings = {};
    for (const name in importedObject) {
      let value = importedObject[name];

      const setting = SettingsConfig.find((setting) => setting.name === name);
      if (!setting) {
        importWarnings.push(
          `已跳过“${name}”：${JSON.stringify(
            value
          )}。该设置可能已删除，或在更新后迁移到了其他名称。`
        );
        continue;
      }

      const { type, min = 0, step = 0.1, max } = setting;
      if (type === 'checkbox' || type === 'section') {
        if (typeof value !== 'boolean') {
          importWarnings.push(
            `已跳过“${name}”：${JSON.stringify(value)} 不是布尔值。`
          );
          continue;
        }
      } else if (type === 'list') {
        if (typeof value !== 'number') {
          importWarnings.push(
            `已跳过“${name}”：${JSON.stringify(value)} 不是数字。`
          );
          continue;
        }
        const valueRoundingLeft = ((value - min) * 1000) % (step * 1000);
        if (valueRoundingLeft !== 0) {
          importWarnings.push(
            `已向下取整“${name}”：${JSON.stringify(
              value
            )} 不符合步进值 ${step}${
              min === undefined ? '' : `（起点 ${min}）`
            }。`
          );
          value = Math.round(value * 1000 - valueRoundingLeft) / 1000;
        }
        if (min !== undefined && value < min) {
          importWarnings.push(
            `已限制“${name}”：${JSON.stringify(
              value
            )} 小于最小值 ${min}。`
          );
          value = min;
        }
        if (max !== undefined && value > max) {
          importWarnings.push(
            `已限制“${name}”：${JSON.stringify(
              value
            )} 大于最大值 ${max}。`
          );
          value = max;
        }
      }

      settings[`setting-${name}`] = value;
    }

    if (!Object.keys(settings).length)
      throw new Error('未找到可导入的设置');

    await storage.set(settings);

    importExportStatus.textContent = `已从${storageName}导入 ${
      Object.keys(settings).length
    } 项设置。
（请刷新已打开的 YouTube 标签页以应用新设置。）${
      importWarnings.length
        ? `\n\n包含 ${importWarnings.length} 条警告：\n- ${importWarnings.join(
            '\n- '
          )}`
        : ''
    }`;
    if (importWarnings.length) {
      importExportStatus.classList.add('has-error');
    }
    importWarnings = [];

    importExportStatusDetails.textContent = `查看已导入的设置（点击查看）\n注意：“模糊”设置在内部会转换为 blur2\n\n${Object.keys(
      settings
    )
      .map(
        (key) =>
          `${key.substring('setting-'.length)}: ${JSON.stringify(
            settings[key]
          )}`
      )
      .join('\n')}`;
  } catch (ex) {
    console.error('Failed to import settings', ex);
    importExportStatus.classList.add('has-error');
    importExportStatus.textContent = `导入设置失败：\n${ex?.message}`;
  }
};
const exportSettings = async (storageName, exportJson) => {
  try {
    importExportStatus.textContent = '';
    importExportStatus.classList.remove('has-error');
    importExportStatusDetails.textContent = '';
    importExportStatusDetails.scrollTo(0, 0);

    const storageData = await storage.get(null);

    let exportObject = {};
    const settings = Object.keys(storageData).filter((key) =>
      key.startsWith('setting-')
    );
    for (const key of settings) {
      const name = key.substring('setting-'.length);
      const existsInConfig = SettingsConfig.some(
        (setting) => setting.name === name
      );
      if (!existsInConfig) continue;

      exportObject[name] = storageData[key];
    }
    if (!Object.keys(exportObject).length)
      throw new Error(
        '没有可导出的内容。所有设置仍为默认值。'
      );

    // Temporarely export the setting blur2 as blur
    // https://github.com/WesselKroos/youtube-ambilight/issues/191#issuecomment-1703792823
    if ('blur2' in exportObject) {
      exportObject.blur = exportObject.blur2;
      delete exportObject.blur2;
    }

    exportObject = Object.keys(exportObject)
      .sort()
      .reduce((obj, key) => ((obj[key] = exportObject[key]), obj), {});

    const jsonString = JSON.stringify(exportObject, null, 2);
    await exportJson(jsonString);
    importExportStatus.textContent = `已将 ${
      Object.keys(exportObject).length
    } 项设置导出到${storageName}`;
    importExportStatusDetails.textContent = `查看已导出的设置（点击查看）\n\n${Object.keys(
      exportObject
    )
      .map((key) => `${key}: ${JSON.stringify(exportObject[key])}`)
      .join('\n')}`;
  } catch (ex) {
    console.error('Failed to export settings', ex);
    importExportStatus.classList.add('has-error');
    importExportStatus.textContent = `导出设置失败：\n${ex?.message}`;
  }
};

const importFileButton = document.querySelector('#importFileBtn');
const importFileInput = document.querySelector('[name="import-settings-file"]');
on(importFileInput, 'change', async () => {
  if (!importFileInput.files.length) return;

  await importSettings('文件', async () => {
    return await new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        on(reader, 'load', (e) => resolve(e.target.result));
        reader.readAsText(importFileInput.files[0]);
      } catch (ex) {
        reject(ex);
      }
      importFileInput.value = '';
    });
  });
});
on(importFileButton, 'click', () => importFileInput.click());

let exportedSettingsLink;
const exportFileButton = document.querySelector('#exportFileBtn');
on(exportFileButton, 'click', async () => {
  await exportSettings('', (jsonString) => {
    const blob = new Blob([jsonString], { type: 'text/plain' });

    const link = (exportedSettingsLink =
      exportedSettingsLink ?? document.createElement('a'));
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', 'ambient-light-for-youtube-settings.json');
    link.setAttribute(
      'title',
      '如果自动下载被拦截：\n1. 右键点击此链接\n2. 点击“链接另存为...”'
    );
    link.style.display = 'block';
    link.style.marginTop = '0';
    link.style.marginBottom = '4px';
    link.textContent = 'ambient-light-for-youtube-settings.json';
    importExportStatusDetails.parentElement.insertBefore(
      link,
      importExportStatusDetails
    );

    link.click();
  });
});

const importAccountButton = document.querySelector('#importAccountBtn');
on(importAccountButton, 'click', async () => {
  await importSettings('云端存储', async () => {
    return await syncStorage.get('settings');
  });
});

const exportAccountButton = document.querySelector('#exportAccountBtn');
on(exportAccountButton, 'click', async () => {
  await exportSettings('云端存储', async (jsonString) => {
    await syncStorage.set('settings', jsonString);
    await syncStorage.set('settings-date', new Date().toJSON());
  });
});

const importableAccountStatus = document.querySelector(
  '#importableAccountStatus'
);
const updateImportableAccountStatus = async () => {
  const jsonString = await syncStorage.get('settings-date');
  if (jsonString) {
    const settingsDate = new Date(jsonString);
    importableAccountStatus.textContent = `上次导出到云端存储的时间：${settingsDate.toLocaleDateString()} ${settingsDate.toLocaleTimeString()}`;
    importAccountButton.disabled = false;
  } else {
    importableAccountStatus.textContent = '';
    importAccountButton.disabled = true;
  }
};
updateImportableAccountStatus();

if (chrome?.storage?.sync?.onChanged) {
  syncStorage.addListener(updateImportableAccountStatus);
  on(window, 'beforeunload', () => {
    syncStorage.removeListener(updateImportableAccountStatus);
  });
}
