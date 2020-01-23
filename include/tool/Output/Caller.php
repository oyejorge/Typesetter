<?php

namespace gp\tool\Output;

class Caller{

	private static $gadget_cache		= array();
	private static $catchable			= array();

	public static function ExecArea($info){
		//retreive from gadget cache if set
		if( isset($info['gpOutCmd']) ){
			$gadget = $info['gpOutCmd'];
			if( substr($gadget, 0, 7) == 'Gadget:' ){
				$gadget = substr($gadget,7);
			}
			if( isset(self::$gadget_cache[$gadget]) ){
				echo self::$gadget_cache[$gadget];
				return;
			}
		}

		$info += array('arg' => '');
		$args = array($info['arg'], $info);

		$info = \gp\tool\Plugins::Filter('ExecArea', array($info, $args));
		if( !$info ){
			return;
		}

		self::ExecInfo($info, $args);
	}



	/**
	 * Execute a set of directives for theme areas, hooks and special pages
	 *
	 */
	public static function ExecInfo($info, $args=array()){
		global $addonFolderName, $installed_addon, $page;

		$args += array('page' => $page);

		//addonDir is deprecated as of 2.0b3
		$addon = false;
		if( isset($info['addonDir']) ){
			$addon = $info['addonDir'];
		}elseif( isset($info['addon']) ){
			$addon = $info['addon'];
		}

		if( $addon !== false ){
			if( gp_safe_mode ){
				return $args;
			}
			\gp\tool\Plugins::SetDataFolder($addon);
		}

		//if addon was just installed
		if( $installed_addon && $installed_addon === $addonFolderName){
			\gp\tool\Plugins::ClearDataFolder();
			return $args;
		}

		// check for fatal errors
		if( self::FatalNotice('exec', $info) ){
			return $args;
		}


		try{
			$args = self::_ExecInfo($info,$args);
		}catch(\Throwable $e){
			\showError( E_ERROR ,'ExecInfo() Fatal Error: '.$e->getMessage(), $e->GetFile(), $e->GetLine(), [], $e->getTrace());
		}

		if( $addon !== false ){
			\gp\tool\Plugins::ClearDataFolder();
		}

		self::PopCatchable();

		return $args;
	}



	public static function _ExecInfo($info, $args=array()){
		global $dataDir, $gp_overwrite_scripts;

		// get data
		if( !empty($info['data']) ){
			IncludeScript($dataDir. $info['data'], 'include_if', array('page', 'dataDir', 'langmessage'));
		}

		// get script
		$has_script = false;
		if( !empty($info['script']) ){

			if( is_array($gp_overwrite_scripts) && isset($gp_overwrite_scripts[$info['script']]) ){
				$full_path = $gp_overwrite_scripts[$info['script']];
			}else{
				$full_path = $dataDir . $info['script'];
			}

			if( !file_exists($full_path) ){
				self::ExecError(\CMS_NAME . ' Error: Addon hook script doesn\'t exist.', $info, 'script');
				return $args;
			}

			if( IncludeScript($full_path, 'include_once', array('page', 'dataDir', 'langmessage')) ){
				$has_script = true;
			}
		}

		//class & method execution
		if( !empty($info['class_admin']) && \gp\tool::LoggedIn() ){
			return self::ExecClass($has_script, $info['class_admin'], $info, $args);
		}elseif( !empty($info['class']) ){
			return self::ExecClass($has_script, $info['class'], $info, $args);
		}

		//method execution
		if( !empty($info['method']) ){
			return self::ExecMethod($has_script, $info, $args);
		}

		return $args;
	}



	/**
	 * Execute hooks that have a ['class'] defined
	 *
	 */
	private static function ExecClass($has_script, $exec_class, $info, $args){

		if( !class_exists($exec_class) ){
			self::ExecError(\CMS_NAME . ' Error: Addon class doesn\'t exist.', $info, 'class');
			return $args;
		}

		$object = new $exec_class($args);

		if( !empty($info['method']) ){
			if( method_exists($object, $info['method']) ){
				$args[0] = call_user_func_array(array($object, $info['method']), $args );
			}elseif( $has_script ){
				self::ExecError(\CMS_NAME . ' Error: Addon hook method doesn\'t exist (1).', $info, 'method');
			}
		}
		return $args;
	}



	/**
	 * Execute hooks that have a ['method'] defined
	 *
	 */
	private static function ExecMethod($has_script, $info, $args){

		$callback = $info['method'];

		//object callbacks since 3.0
		if( is_string($callback) && strpos($callback, '->') !== false ){
			$has_script = true;
			list($object,$method) = explode('->', $callback);
			if( isset($GLOBALS[$object])
				&& is_object($GLOBALS[$object])
				&& method_exists($GLOBALS[$object],$method)
				){
				$callback = array($GLOBALS[$object],$method);
			}
		}

		if( is_callable($callback) ){
			$args[0] = call_user_func_array($callback,$args);

		}elseif( $has_script ){
			self::ExecError(\CMS_NAME.' Error: Addon hook method doesn\'t exist (2).', $info, 'method');
		}

		return $args;
	}



	/**
	 * Trigger an error
	 *
	 */
	public static function ExecError( $msg, $exec_info, $error_info ){
		global $config, $addonFolderName;

		// append addon name
		if( !empty($addonFolderName) && isset($config['addons'][$addonFolderName]) ){
			$msg	.= ' Addon: ' . $config['addons'][$addonFolderName]['name'] . '. ';
		}

		// which piece of $exec_info is the problem
		if( !isset($exec_info[$error_info]) ){
			$msg	.= $error_info;
		}elseif( is_array($exec_info[$error_info]) ){
			$msg	.= $error_info . ': ' . implode('::',$exec_info[$error_info]);
		}else{
			$msg	.= $error_info . ': ' . $exec_info[$error_info];
		}

		trigger_error($msg);
	}


	/**
	 * Prepare the gadget content before getting template.php
	 * so that gadget functions can add css and js to the head
	 * @return null
	 */
	public static function PrepGadgetContent(){
		global $page;

		//not needed for admin pages
		if( $page->pagetype == 'admin_display' ){
			return;
		}

		$gadget_info = \gp\tool\Output::WhichGadgets($page->gpLayout);

		foreach($gadget_info as $gpOutCmd => $info){
			if( !isset(self::$gadget_cache[$gpOutCmd]) ){
				ob_start();
				self::ExecArea($info);
				self::$gadget_cache[$gpOutCmd] = ob_get_clean();
			}
		}
	}


	/**
	 * Check for fatal errors corresponing to $hash
	 * Notify administrators of disabled components
	 *
	 */
	public static function FatalNotice( $type, $info ){
		global $dataDir, $page;
		static $notified = false;

		$info					= (array)$info;
		$info['catchable_type']	= $type;

		$hash_dir				= $dataDir . '/data/_site/fatal_' . $type . '_' . \gp\tool::ArrayHash($info);
		$hash_request			= $hash_dir . '/' . \gp\tool::ArrayHash($_REQUEST);

		self::$catchable[$hash_request]	= $info;

		if( !self::FatalLimit($hash_dir) ){
			return false;
		}

		if( !$notified ){
			error_log( 'Warning: A component of this page has been disabled because it caused fatal errors' );
			$notified = true;
		}

		self::PopCatchable();

		return true;
	}


	/**
	 * Return true if the limit of fatal errors has been reached
	 *
	 */
	public static function FatalLimit($hash_dir){

		//no folder = no fatal error
		if( !file_exists($hash_dir) ){
			return false;
		}

		// if the error didn't occur for the exact request and it hasn't happend a lot, allow the code to keep working
		$fatal_hashes = scandir($hash_dir);
		if( $fatal_hashes !== false && count($fatal_hashes) < (gp_allowed_fatal_errors + 3) ){
			// add 3 for ".", ".." and "index.html" entries
			return false;
		}

		return true;
	}


	public static function PopCatchable(){
		array_pop(self::$catchable);
	}


	/**
	 * Return the message displayed when a fatal error has been caught
	 *
	 */
	public static function FatalMessage( $error_details ){

		$message = '<p>Oops, an error occurred while generating this page.<p>';

		if( !\gp\tool::LoggedIn() ){

			//reload non-logged in users automatically if there were catchable errors
			if( !empty(self::$catchable) ){
				$message .= 'Reloading... <script type="text/javascript">'
					. 'window.setTimeout(function(){window.location.href = '
					. 'window.location.href},1000);</script>';
			}else{
				$message .= '<p>If you are the site administrator, you can troubleshoot '
					. 'the problem by changing php\'s display_errors setting to 1 in '
					. 'the gpconfig.php file.</p><p>If the problem is being caused by an addon, '
					. 'you may also be able to bypass the error by enabling ' . \CMS_NAME . '\'s '
					. 'safe mode in the gpconfig.php file.</p><p>More information is available '
					. 'in the <a href="' . \CMS_DOMAIN . '/Docs/Main/Troubleshooting">Documentation</a>.'
					. '</p><p><a href="?">Reload this page to continue</a>.</p>';
			}

			return $message;
		}


		$message .= '<h3>Error Details</h3>'
				.pre($error_details)
				. '<p><a href="?">Reload this page</a></p>'
				. '<p style="font-size:90%">Note: Error details are only '
				. 'displayed for logged in administrators</p>'
				. \gp\tool::ErrorBuffer(true, false);

		return $message;
	}


	/**
	 * Record fatal errors in /data/_site/ so we can prevent subsequent requests from having the same issue
	 *
	 */
	public static function RecordFatal($last_error){
		global $config, $addon_current_id, $addonFolderName;

		$last_error['request'] = $_SERVER['REQUEST_URI'];
		if( $addon_current_id ){
			$last_error['addon_name'] = $config['addons'][$addonFolderName]['name'];
			$last_error['addon_id'] = $addon_current_id;
		}

		$last_error['file'] = realpath($last_error['file']);//may be redundant
		showError( $last_error['type'], $last_error['message'], $last_error['file'], $last_error['line'], false ); //send error to logger

		if( empty(self::$catchable) ){
			return;
		}

		$last_error['time'] = time();
		$last_error['request_method'] = $_SERVER['REQUEST_METHOD'];
		if( !empty($last_error['file']) ){
			$last_error['file_modified'] = filemtime($last_error['file']);
			$last_error['file_size'] = filesize($last_error['file']);
		}

		$content	= json_encode($last_error);
		$temp		= array_reverse(self::$catchable);

		foreach($temp as $filepath => $info){

			\gp\tool\Files::Save($filepath,$content);

			if( $info['catchable_type'] == 'exec' ){
				break;
			}
		}

	}

}
