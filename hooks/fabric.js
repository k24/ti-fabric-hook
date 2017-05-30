var _ = require('lodash'),
	chalk = require('chalk'),
	fs = require('fs-extra'),
	path = require('path'),
	xcode = require('xcode'),
	pkg = require(path.join(__dirname, '..', 'package.json'));

exports.id = 'ti.fabric';
exports.cliVersion = '>=3.2';

exports.init = function init(logger, config, cli, appc) {
	if (!_.has(cli.argv, 'fabric')) {
		return;
	}

	if (_.has(cli.argv, 'fabric-help')) {
		logger.info('\n\n' + chalk.cyan.bold(pkg.name) + ', Plugin version ' + pkg.version + ', ' + pkg.description + '\n' +
			chalk.gray('Copyright (c) ' + pkg.author) + '\n\n' +
			'Usage: ' + chalk.cyan('titanium build --fabric [options]') + '\n' +
			'Options:\n' +
			'   ' + chalk.cyan('--fabric-help') + '\t\tdisplay this message\n\n' +
			'Crashlytics Options:\n' +
			'   ' + chalk.cyan('--crashlytics-ipaPath') + '\t[path to IPA] ' + chalk.gray('[default: ' + path.join('build', 'iphone', 'build', 'Debug-iphoneos', cli.tiapp.name + '.ipa') + ']') + '\n' +
			'   ' + chalk.cyan('--crashlytics-emails') + '\t\t[tester email address],[email] ' + chalk.gray('[default: no specific]') + '\n' +
			'   ' + chalk.cyan('--crashlytics-groupAliases') + '\t[group build server alias],[group] ' + chalk.gray('[default: no specific]') + '\n' +
			'   ' + chalk.cyan('--crashlytics-notesPath') + '\t[release notes] ' + chalk.gray('[default: no specific]') + '\n' +
			'   ' + chalk.cyan('--crashlytics-notifications') + '\tYES|NO ' + chalk.gray('[default: no specific]') + '\n' +
			'   ' + chalk.cyan('--crashlytics-debug') + '\t\tYES|NO ' + chalk.gray('[default: no specific]') + '\n' +
			'   ' + chalk.cyan('--crashlytics-submit') + '\t\tYES|NO ' + chalk.gray('[default: NO]') + '\n');

		process.exit(1);
	}

	var source = {
			fabric: path.join(__dirname, '..', '..', '..', '..', 'Fabric.framework'),
			crashlytics: path.join(__dirname, '..', '..', '..', '..', 'Crashlytics.framework')
		},
		destination = {
			fabric: path.join(__dirname, '..', '..', '..', '..', 'build', 'iphone', 'Fabric.framework'),
			crashlytics: path.join(__dirname, '..', '..', '..', '..', 'build', 'iphone', 'Crashlytics.framework')
		},
		tiappm = path.join(__dirname, '..', '..', '..', '..', 'build', 'iphone', 'Classes', 'TiApp.m'),
		pbxproj = path.join(__dirname, '..', '..', '..', '..', 'build', 'iphone', cli.tiapp.name + '.xcodeproj', 'project.pbxproj'),
		project = xcode.project(pbxproj),
		xcconfig = path.join(__dirname, '..', '..', '..', '..', 'build', 'iphone', 'project.xcconfig'),
		crashlytics = {
			ipaPath: path.join(__dirname, '..', '..', '..', '..', 'build', 'iphone', 'build', 'Debug-iphoneos', cli.tiapp.name + '.ipa'),
			emails: '',
			groupAliases: '',
			notesPath: '',
			notifications: '',
			debug: '',
			submit: 'NO'
		};

	cli.on('build.pre.construct', function(data, callback){
		if (!fs.existsSync(source.fabric)) {
			logger.error(source.fabric + ' does not exists');
			process.exit(1);
		}

		if (!fs.existsSync(source.crashlytics)) {
			logger.error(source.crashlytics + ' does not exists');
			process.exit(1);
		}

		if (!_.has(cli.tiapp, 'ios') ||
			!_.has(cli.tiapp.ios, 'plist') ||
			!_.has(cli.tiapp.ios.plist, 'Fabric') ||
			!_.has(cli.tiapp.ios.plist.Fabric, 'APIKey') ||
			!_.has(cli.tiapp.ios.plist.Fabric, 'BuildSecret')) {
			logger.error('Does not detect the Fabric section in tiapp.xml');
			process.exit(1);
		}

		_.each(_.map(cli.argv, function(item, index){
			if (index.match(/^crashlytics-/)) {
				return {
					key: index.replace(/^crashlytics-/, ''),
					value: item
				};
			}
		}), function(item){
			if (item && _.has(crashlytics, item.key)) {
				crashlytics[item.key] = item.value;
			}
		});

		callback();
	});

	cli.on('build.ios.xcodebuild', {pre: function(data, callback){
		logger.info('Coping Fabric.framework: ' + chalk.cyan(destination.fabric));
		fs.ensureSymlinkSync(source.fabric, destination.fabric);

		logger.info('Coping Crashlytics.framework: ' + chalk.cyan(destination.crashlytics));
		fs.ensureSymlinkSync(source.crashlytics, destination.crashlytics);

		var code = '';

		logger.info('Fabric code injecting: ' + chalk.cyan(tiappm));
		code = fs.readFileSync(tiappm, 'utf8');
		code = code.replace(/(#import\s"TiApp\.h")/, '$1\n#import <Fabric/Fabric.h>\n#import <Crashlytics/Crashlytics.h>');
		code = code.replace(/(-\s\(BOOL\)application:\(UIApplication\s\*\)application\sdidFinishLaunchingWithOptions:\(NSDictionary\s\*\)launchOptions_\n\{\n)/m,
			'$1    [Fabric with:@[CrashlyticsKit]];\n\n');
		fs.writeFileSync(tiappm, code);

		logger.info('Fabric code injecting: ' + chalk.cyan(xcconfig));
		code = fs.readFileSync(xcconfig, 'utf8');
		code = code.replace(/(TICORE_LD_FLAGS=-weak-lti_ios_profiler\s-weak-lti_ios_debugger\s-weak-lTiCore)/, '$1 -framework Fabric -framework Crashlytics');
		fs.writeFileSync(xcconfig, code);

		logger.info('Fabric code injecting: ' + chalk.cyan(pbxproj));
		project.parse(function(err){
			if (err) {
				process.exit(1);
			}

			project.addFramework(destination.fabric, {
				customFramework: true
			});
			project.addFramework(destination.crashlytics, {
				customFramework: true
			});
			fs.writeFileSync(pbxproj, project.writeSync());

			callback(null, data);
		});
	}});

	cli.on('build.finalize', function(data, callback){
		var option = [];

		if (crashlytics.submit === 'YES') {
			logger.info('Auto deploying Fabric/Crashlytics...');

			option.push(cli.tiapp.ios.plist.Fabric.APIKey);
			option.push(cli.tiapp.ios.plist.Fabric.BuildSecret);

			_.map(crashlytics, function(item, index){
				if (index !== 'submit' && item) {
					option.push('-' + index);
					option.push(item);
				}
			});

			appc.subprocess.run(path.join(destination.crashlytics, 'submit'), option, function(code, res, err){
				_.each(res.split('\n'), function(item){
					logger.info(item);
				});

				callback();
			});
		} else {
			logger.info('.ipa file deploy to Fabric Crashlytics usage at ' + chalk.cyan.underline('https://dev.twitter.com/crashlytics/beta-distribution/ios'));

			callback();
		}
	});
};
