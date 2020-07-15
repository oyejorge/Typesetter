
(function(){

	gp_editing = {

		autosave_interval:	5000, // in milliseconds
		can_autosave:		true, // default value, editor components can still deny

		is_extra_mode:		false,
		is_dirty:			false,	// true if we know gp_editor has been edited


		debug:function(msg){
			if( debugjs ){
				console.log(msg);
			}
		},


		get_path:function(id_num){
			var lnk = $('a#ExtraEditLink' + id_num);
			if( lnk.length == 0 ){
				gp_editing.debug('get_path() link not found', id_num, lnk.length);
				return false;
			}
			return lnk.attr('href');
		},


		get_edit_area:function(id_num){

			var content = $('#ExtraEditArea' + id_num);
			if( content.length == 0 ){
				gp_editing.debug('no content found for get_edit_area()', id_num);
				return false;
			}

			$('#edit_area_overlay_top').hide();

			//use the div with the twysiwygr class for True WYSIWYG Replacement if it's found
			var replace_content = content.find('.twysiwygr').first();
			if( replace_content.length ){
				content = replace_content;
			}

			content.addClass('gp_editing gp_edit_current');

			return content;
		},


		/**
		 * Close the editor instance
		 * Fired when the Close button is clicked
		 *
		 */
		close_editor:function(evt){
			evt.preventDefault();

			//reload the page so javascript elements are shown again
			$gp.Reload();
		},


		/**
		 * Save Changes
		 * Close after the save if 'Save & Close' was clicked
		 *
		 */
		SaveChanges:function(callback, create_draft){

			if( !gp_editor ){
				return;
			}

			if( !gp_editing.IsDirty() ){
				if( typeof(callback) == 'function' ){
					callback.call();
				}
				return;
			}

			if( typeof(create_draft) == 'undefined' ){
				var create_draft = true;
			}

			var $wrap = $('#ckeditor_wrap');

			if( $wrap.hasClass('ck_saving') ){
				return;
			}

			loading();

			$wrap.addClass('ck_saving');
			gp_editing.AutoSave.destroy(); // kill the autosave timer while saving to avoid timing conflicts

			$("a.msg_publish_draft").hide();
			$("a.msg_publish_draft_disabled").hide();
			$("a.msg_saving_draft").css('display', 'block');

			var $edit_div	= $gp.CurrentDiv();
			var path		= strip_from(gp_editor.save_path, '#');
			var query		= '';
			var save_data	= gp_editing.GetSaveData();

			if( path.indexOf('?') > 0 ){
				query		= strip_to(path, '?') + '&';
				path		= strip_from(path, '?');
			}

			query		+= 'cmd=save_inline';
			query		+= '&section=' + $edit_div.data('gp-section');
			query		+= '&req_time=' + req_time;
			query		+= '&' + save_data;
			query		+= '&verified=' + encodeURIComponent(post_nonce);
			query		+= '&gpreq=json&jsoncallback=?';

			// saving to same page as the current url
			if( gp_editing.SamePath(path) ){
				query += '&gpreq_toolbar=1';
			}

			// prevent draft
			if( !create_draft ){
				query += '&prevent_draft=1';
			}

			//the saved function
			$gp.response.ck_saved = function(){

				//mark as draft
				gp_editing.DraftStatus($edit_div, 1);
				gp_editing.PublishButton($edit_div);

				if( !gp_editor ){
					return;
				}

				//if nothing has changed since saving
				if( gp_editing.GetSaveData() == save_data ){
					gp_editor.resetDirty();
					gp_editing.is_dirty = false;
					gp_editing.DisplayDirty();
				}

				if( typeof(callback) == 'function' ){
					callback.call();
				}
			}

			$.ajax({
				type		: 'POST',
				url			: path,
				data		: query,
				success		: $gp.Response,
				dataType	: 'json',
				complete	: function(jqXHR, textStatus){
					$wrap.removeClass('ck_saving');
					$("a.msg_publish_draft").css('display', 'block');
					$("a.msg_publish_draft_disabled").hide();
					$("a.msg_saving_draft").hide();
					gp_editing.AutoSave.init(); // re-init autosave when saving completed
					loaded();
				},
			});

		},


		/**
		 * Get the data to be saved from the gp_editor
		 * @since 5.0
		 *
		 */
		GetSaveData: function(){

			if( typeof(gp_editor.SaveData) == 'function' ){
				return gp_editor.SaveData();
			}

			return gp_editor.gp_saveData();
		},


		/**
		 * Display the publish and dismiss buttons if the edit extra area is a draft
		 *
		 */
		PublishButton: function($area){
			if( !$area || $area.data('draft') == undefined ){ // draft attr only used for extra content
				document.querySelectorAll('.ckeditor_control.ck_publish').forEach(function(el) {
					el.style.setProperty('display','none','important');
				});
				return;
			}

			if( $area.data('draft') == 1 ){
				document.querySelectorAll('.ckeditor_control.ck_publish, .ck_publish[data-gp-area-id="' + $gp.AreaId($area) + '"]').forEach(function(el) {
					el.style.removeProperty('display');
				});				
			} else {
				document.querySelectorAll('.ckeditor_control.ck_publish, .ck_publish[data-gp-area-id="' + $gp.AreaId($area) + '"]').forEach(function(el) {
					el.style.setProperty('display','none','important');
				});
			}	

			$gp.IndicateDraft();
		},


		/**
		 * Set the draft status for an edit area
		 *
		 */
		DraftStatus: function($area, status){

			if( !$area || $area.data('draft') == undefined ){ // draft attr only used for extra content
				return;
			}

			$area.data('draft', status).attr('data-draft', status);
			$gp.IndicateDraft();
		},


		/**
		 * Return true if the request path is the same as the path for the current url
		 *
		 */
		SamePath: function(path){
			var a = $('<a>').attr('href',path).get(0);

			if( a.pathname.replace(/^\/index.php/, '') == window.location.pathname.replace(/^\/index.php/, '') ){
				return true;
			}
			return false;
		},


		/**
		 * Get the Editor Tools area
		 * Initiate dragging
		 *
		 */
		editor_tools: function(){

			var $ck_area_wrap = $('#ck_area_wrap');

			//inline editor html
			if( !$ck_area_wrap.length ){

				var editor_expanded_class = !!gpui.exp ? ' editor_expanded' : '';

				var html = '<div id="ckeditor_wrap" class="nodisplay' + editor_expanded_class + '">';

				html += '<a id="cktoggle" data-cmd="ToggleEditor">';
				html += '<i class="fa fa-angle-double-left"></i><i class="fa fa-angle-double-right"></i>';
				html += '</a>';

				//expandable editor
				html += '<a id="editor_toggle_width" data-cmd="ToggleEditorWidth">';
				html += '<i title="' + gplang.ExpandEditor + '" class="fa fa-plus-square-o"></i>';
				html += '<i title="' + gplang.ShrinkEditor + '" class="fa fa-minus-square-o"></i>';
				html += '</a>';

				//tabs
				html += '<div id="ckeditor_tabs">';
				html += '</div>';

				html += '<div id="ck_area_wrap">';
				html += '</div>';

				html += '<div id="ckeditor_save">';
				html += '<a data-cmd="ck_save" class="ckeditor_control ck_save">' + gplang.Save + '</a>';
				html += '<span class="ck_saving">' + gplang.Saving + '</span>';
				html += '<span class="ck_saved">' + gplang.Saved + '</span>';
				html += '<a data-cmd="Publish" class="ckeditor_control ck_publish">' + gplang.Publish + '</>';
				html += '<a data-cmd="Dismiss" class="ckeditor_control ck_publish">' + gplang.Dismiss + '</>';
				html += '<a data-cmd="ck_close" class="ckeditor_control">' + gplang.Close + '</a>';
				html += '</div>';

				html += '<div id="ckeditor_close">';
				html += '<a data-cmd="ck_close" class="ckeditor_control">' + gplang.Close + '</a>';
				html += '</div>';

				html += '</div>';

				$('#gp_admin_html').append(html);

				$('html').addClass('gpEditing');
				$(document).trigger('editor_area:loaded');

				$ck_area_wrap = $('#ck_area_wrap');
			}


			//ck_area_wrap
			var html = '<div id="ckeditor_area">';
			html += '<div class="toolbar"></div>';
			html += '<div class="tools">';
			html += '<div id="ckeditor_top"></div>';
			html += '<div id="ckeditor_controls"></div>';
			html += '<div id="ckeditor_bottom"></div>';
			html += '</div>';
			html += '</div>';
			$ck_area_wrap.html(html);

			gp_editing.ShowEditor();
		},


		/**
		 * Which edit mode? Page or Extra Content
		 *
		 */
		IsExtraMode: function(){

			var $edit_area = $gp.CurrentDiv();

			if( !$edit_area.length ){
				return gp_editing.is_extra_mode;
			}

			if( typeof($edit_area.data('gp-section')) == 'undefined' ){
				gp_editing.is_extra_mode = true;
				return true;
			}

			gp_editing.is_extra_mode = false;
			return false;
		},


		/**
		 * Display the editing window and update the editor heading
		 *
		 */
		ShowEditor: function(){

			var $edit_area		= $gp.CurrentDiv();
			var $ckeditor_wrap	= $('#ckeditor_wrap').addClass('show_editor');
			$gp.$win.trigger('resize');

			//tabs
			var $tabs			= $('#ckeditor_tabs').html('');
			var extra_mode		= gp_editing.IsExtraMode();

			if( extra_mode ){
				$ckeditor_wrap.addClass('edit_mode_extra');
				$tabs.append('<a href="?cmd=ManageSections" data-cmd="inline_edit_generic" '
					+ 'data-arg="manage_sections" title="' + gplang.Extra + '">' + gplang.Extra + '</a>');
			}else{
				$ckeditor_wrap.removeClass('edit_mode_extra');
				$tabs.append('<a href="?cmd=ManageSections" data-cmd="inline_edit_generic" '
					+ 'data-arg="manage_sections" title="' + gplang.Sections + '">' + gplang.Sections + '</a>');
			}

			var label = false;
			if( $edit_area.length != 0 ){
				label			= gp_editing.SectionLabel($edit_area);
				$('<a>').attr('title', label).text(label).appendTo( $tabs );
			}

			// Hide save buttons for extra content list
			if( $edit_area.length == 0 && extra_mode ){
				$('#ckeditor_save').hide();
				$('#ckeditor_close').show();
			}else{
				$('#ckeditor_save').show();
				$('#ckeditor_close').hide();
			}

			// gather information passed to the editor:loaded event
			var editor_info = {
				editor			: gp_editor,
				section 		: false,
				section_type 	: false,
				label			: label
			}

			if( gp_editing.get_edit_area($gp.curr_edit_id) ){
				editor_info.section 		= gp_editing.get_edit_area($gp.curr_edit_id);
				var section_type 			= editor_info.section.attr('class').match(/filetype-\w*/gi).toString();
				editor_info.section_type 	= section_type.substring(section_type.indexOf('filetype-') + 9);
			}

			// do not expand the editor area when CK Editor is active
			if( editor_info.section_type == 'text' ){
				$('#ckeditor_wrap').addClass('overrule_editor_expanded');
			}else{
				$('#ckeditor_wrap').removeClass('overrule_editor_expanded');
			}


			$(document).trigger('editor:loaded', editor_info);

			gp_editing.PublishButton( $edit_area );
		},


		/**
		 * Get a section label
		 *
		 */
		SectionLabel: function($section){

			var label	= $section.data('gp_label');
			if( !label ){
				var type	= gp_editing.TypeFromClass($section);
				label	= gp_editing.ucfirst(type);
			}

			return label;
		},


		/**
		 * Get the content type from the class name
		 * TODO: use regexp to find filetype-.*
		 */
		TypeFromClass: function(div){
			var $section	= $(div);
			var type		= $section.data('gp_type');
			if( type ){
				return type;
			}

			var type = $section.prop('class').substring(16);
			return type.substring(0, type.indexOf(' '));
		},


		/**
		 * Capitalize the first letter of a string
		 *
		 */
		ucfirst: function( str ){
			return str.charAt(0).toUpperCase() + str.slice(1);
		},


		/**
		 * Set up tabs
		 *
		 */
		CreateTabs: function(){

			var $areas = $('.inline_edit_area');
			if( !$areas.length ){
				return;
			}

			var c = 'selected'
			var h = '<div id="cktabs" class="cktabs">';
			$areas.each(function(){
				h += '<a class="ckeditor_control ' + c + '" data-cmd="SwitchEditArea" '
					+ 'data-arg="#' + this.id + '">' + this.title + '</a>';
				c = '';
			});
			h += '</div>';

			$('#ckeditor_area .toolbar').append(h).find('a').mousedown(function(e) {
				e.stopPropagation(); //prevent dragging
			});

		},


		/**
		 * Add Tab
		 *
		 */
		AddTab: function(html, id){

			var $area = $('#' + id);
			if( !$area.length ){
				$area = $(html).appendTo('#ckeditor_top');

				$('<a class="ckeditor_control" data-cmd="SwitchEditArea" '
					+ 'data-arg="#' + id + '">' + $area.attr('title') + '</a>')
					.appendTo('#cktabs')
					.trigger('click');
			}else{
				$area.replaceWith(html);
				$('#cktabs .ckeditor_control[data-arg="#' + id + '"]').trigger('click');

			}
		},


		/**
		 * Restore Cached
		 *
		 */
		RestoreCached: function(id){

			if( typeof($gp.interface[id]) != 'object' ){
				return false;
			}

			if( $gp.curr_edit_id === id ){
				return true;
			}

			$('#ck_area_wrap').html('').append($gp.interface[id]);

			gp_editor			= $gp.editors[id];
			$gp.curr_edit_id	= id;

			$gp.RestoreObjects( 'links', id);
			$gp.RestoreObjects( 'inputs', id);
			$gp.RestoreObjects( 'response', id);

			gp_editing.ShowEditor();

			if( typeof(gp_editor.wake) == 'function' ){
				gp_editor.wake();
			}

			var $edit_div = $gp.CurrentDiv().addClass('gp_edit_current');

			return true;
		},


		/**
		 * Return true if the editor has been edited
		 *
		 */
		IsDirty: function(){

			gp_editing.is_dirty = true;

			if( typeof(gp_editor.checkDirty) == 'undefined' ){
				return true;
			}

			if( gp_editor.checkDirty() ){
				return true;
			}

			gp_editing.is_dirty = false;
			return false;
		},


		/**
		 * Hide the "Saved" indicator if the
		 *
		 */
		DisplayDirty: function(){

			if( gp_editing.is_dirty || gp_editing.IsDirty() ){
				$('#ckeditor_wrap').addClass('not_saved');
				$("a.msg_publish_draft").hide();
				$("a.msg_publish_draft_disabled").css('display', 'block');
				// $("a.msg_saving_draft").css('display', 'block');
			}else{
				$('#ckeditor_wrap').removeClass('not_saved');
				$("a.msg_publish_draft").css('display', 'block');
				$("a.msg_publish_draft_disabled").hide();
				// $("a.msg_saving_draft").hide();
			}
		},


		/**
		 * Deprecated methods
		 */
		save_changes: function(callback){
			gp_editing.debug('Please use gp_editing.SaveChanges() instead of gp_editing.save_changes()');
			gp_editing.SaveChanges(callback);
		},


		// auto save

		AutoSave: {

			init : function(){
				if( !gp_editing.can_autosave ){
					return;
				}
				gp_editing.autosave_timer = window.setInterval(function(){
					if( (typeof(gp_editor.CanAutoSave) == 'function' &&
						!gp_editor.CanAutoSave()) || !gp_editing.can_autosave
						){
						return;
					}
					gp_editing.SaveChanges();
				}, gp_editing.autosave_interval);
			},

			reset : function(){
				gp_editing.AutoSave.destroy();
				gp_editing.AutoSave.init();
			},

			suspend : function(){
				gp_editing.can_autosave = false;
			},

			resume : function(){
				gp_editing.can_autosave = true;
			},

			destroy : function(){
				if( typeof(gp_editing.autosave_timer) == 'number' ){
					clearInterval(gp_editing.autosave_timer);
				}
			}
		}

	}; // end of gp_editing


	/**
	 * init AutoSave
	 *
	 */
	gp_editing.AutoSave.init();


	/**
	 * Close button
	 *
	 */
	$gp.links.ck_close = gp_editing.close_editor;

	/**
	 * Save button clicks
	 *
	 */
	$gp.links.ck_save = function(evt, arg){
		evt.preventDefault();

		gp_editing.SaveChanges(function(){
			if( arg && arg == 'ck_close' ){
				gp_editing.close_editor(evt);
			}
		});
	}


	/**
	 * Control which editing area is displayed
	 *
	 */
	$gp.links.SwitchEditArea = function(evt,arg){

		if( this.href ){
			$gp.links.inline_edit_generic.call(this, evt, 'manage_sections');
		}

		var $this = $(this);

		$('.inline_edit_area').hide();
		$( $this.data('arg') ).show();

		$this.siblings().removeClass('selected');
		$this.addClass('selected');
	}


	/**
	 * Warn before closing a page if an inline edit area has been changed
	 *
	 */
	$(window).on('beforeunload', function(){

		//check current editor
		if( typeof(gp_editor.checkDirty) !== 'undefined' && gp_editor.checkDirty() ){
			return 'Unsaved changes will be lost.';
		}

	});


	/**
	 * Switch between edit areas
	 *
	 * Using $gp.$doc.on('click') so we can stopImmediatePropagation() for other clicks
	 *
	 * Not using $('#ExtraEditLink'+area_id).on('click') to avoid triggering other click handlers
	 *
	 */
	$gp.$doc.on('click', '.editable_area:not(.filetype-wrapper_section)', function(evt){

		//get the edit link
		var area_id		= $gp.AreaId($(this));
		if( area_id == $gp.curr_edit_id ){
			return;
		}

		var $lnk = $('#ExtraEditLink' + area_id);

		if( $lnk.attr('data-cmd') == 'gpabox' ){
			// legacy gpArea
			return;
		}

		evt.stopImmediatePropagation(); //don't check if we need to swith back to the section manager

		var arg = $lnk.data('arg');
		$gp.LoadEditor($lnk.get(0).href, area_id, arg);

	});


	/**
	 * Switch back to the section manager
	 * Check for .cke_reset_all because ckeditor creates dialogs outside of gp_admin_html
	 * .. Issues: continually growing list of areas to check for: colorbox gallery
	 *
	$gp.$doc.on('click',function(evt){

		if( $(evt.target).closest('.editable_area, #gp_admin_html, .cke_reset_all, a, input').length ){
			return;
		}

		$gp.LoadEditor('?cmd=ManageSections', 0, 'manage_sections');

	});
	 */


	// check dirty
	$gp.$doc.on('keyup mouseup', function(){
		window.setTimeout(gp_editing.DisplayDirty, 100);
	});


	/**
	 * Show/Hide the editor
	 *
	 */
	$gp.links.ToggleEditor = function(){
		if( $('#ckeditor_wrap').hasClass('show_editor') ){
			$('html').css({'margin-left': 0});
			$('#ckeditor_wrap').removeClass('show_editor');
			$gp.$win.trigger('resize');
		}else{
			gp_editing.ShowEditor();
		}
	};


	/**
	 * Expand / shrink the editor area
	 *
	 */
	$gp.links.ToggleEditorWidth = function(){
		$('#ckeditor_wrap').toggleClass('editor_expanded');
		gpui.exp = $('#ckeditor_wrap').hasClass('editor_expanded') ? 1 : 0;
		$gp.SaveGPUI();
	};


	/**
	 * Move the page to the left to keep the editor off of the editable area if needed
	 *
	 */
	function AdjustForEditor(){

		$('html').css({'margin-left' : 0, 'width' : 'auto'});

		var win_width	= $gp.$win.width();
		var $edit_div	= $gp.CurrentDiv();
		if( !$edit_div.length ){
			return;
		}

		//get max adjustment
		var left 		= $edit_div.offset().left;
		var max_adjust	= left - 10;
		if( max_adjust < 0 ){
			return;
		}

		//get min adjustment (how much the edit div will overlap the editor)
		var max_right	= win_width - $('#ckeditor_wrap').outerWidth(true);
		var min_adjust	= (left + $edit_div.outerWidth()) - max_right;
		min_adjust		+= 10;

		if( min_adjust < 0 ){
			return;
		}

		var adjust		= Math.min(min_adjust, max_adjust);

		$('html').css({
			'margin-left'	: -adjust,
			'width'			: win_width
		});
	}


	/**
	 * Max height of #ckeditor_area
	 *
	 */
	$gp.$win.on('resize', function(){
		var $ckeditor_area		= $('#ckeditor_area');
		if( $ckeditor_area.length ){
			var maxHeight			= $gp.$win.height();
			maxHeight				-= $ckeditor_area.position().top;
			maxHeight				-= $('#ckeditor_save').outerHeight();
			maxHeight				-= $('#ckeditor_close').outerHeight();

			$('#ckeditor_area').css({'max-height': maxHeight});

			AdjustForEditor();
		}

	}).trigger('resize');


	/**
	 * Publish the current draft
	 *
	 */
	$gp.links.Publish = function(){

		var $edit_area		= $gp.CurrentDiv();
		var id_num			= $gp.AreaId( $edit_area );
		var href			= gp_editing.get_path( id_num );
		href				= $gp.jPrep(href, 'cmd=PublishDraft');

		$(this).data('gp-area-id', id_num);

		$gp.jGoTo(href,this);
	};


	/**
	 * Dismiss the current draft
	 *
	 */
	$gp.links.Dismiss = function(){

		var $edit_area		= $gp.CurrentDiv();
		var id_num			= $gp.AreaId( $edit_area );
		var href			= gp_editing.get_path( id_num );
		href				= $gp.jPrep(href, 'cmd=DismissDraft');

		$(this).data('gp-area-id', id_num);

		$gp.jGoTo(href,this);
	};


	/**
	 * Response when an area
	 *
	 */
	$gp.response.DraftPublished = function(){
		var $this		= $(this); //.css('display','none !important');
		var id_number	= $gp.AreaId( $this );

		var $area		= $('#ExtraEditArea' + id_number);

		gp_editing.DraftStatus($area, 0);
		gp_editing.PublishButton($area);
	};


	$gp.response.DraftDismissed = function(){
		$gp.Reload();
	};



	$('.editable_area').off('.gp');
	$gp.$doc.off('click.gp');

})();
