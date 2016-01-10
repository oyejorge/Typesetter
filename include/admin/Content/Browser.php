<?php

namespace gp\admin\Content{

	defined('is_running') or die('Not an entry point...');

	class Browser extends \gp\admin\Content\Uploaded{

		function __construct(){
			global $page;

			$_REQUEST += array('gpreq' => 'body'); //force showing only the body as a complete html document
			$page->get_theme_css = false;

			$page->head .= '<style type="text/css">';
			$page->head .= 'html,body{padding:0;margin:0;background-color:#ededed !important;background-image:none !important;border:0 none !important;}';
			$page->head .= '#gp_admin_html{padding:5px 0 !important;}';
			$page->head .= '</style>';

			$this->Finder();
		}

		function FinderPrep(){
			$this->finder_opts['url']				= \gp\tool::GetUrl('Admin_Finder');
			$this->finder_opts['getFileCallback']	= true;
			$this->finder_opts['resizable'] 		= false;
		}

	}
}

namespace{
	class admin_browser extends \gp\admin\Content\Browser{}
}
